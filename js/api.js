// Data access for the site. Views call these functions and get normalized models
// (see js/normalize.js), never raw ESPN JSON.
//
// Live ESPN calls are tried first for current data. When they fail (CORS, network,
// ESPN changes) the archive in /data written by the GitHub Action is used instead,
// and the result says so via `source: 'archive'` and `updated`.

import {
  LEAGUES, normalizeScoreboard, normalizeStandings, normalizeRanking, pickAP, normalizeSchedule,
} from './normalize.js';

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const V2 = 'https://site.api.espn.com/apis/v2/sports/football';
const DATA = new URL('../data/', import.meta.url).href;

const cache = new Map();

async function getJSON(url, { ttl = 0, timeout = 10000 } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctl.signal, cache: ttl ? 'no-cache' : 'default' });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const data = await res.json();
    cache.set(url, { at: Date.now(), data });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

const archive = (path, ttl = 60_000) => getJSON(DATA + path, { ttl });

export function weekFile(seasonType, week) {
  const prefix = seasonType === 1 ? 'pre' : seasonType === 3 ? 'post' : 'week';
  return `${prefix}-${week}.json`;
}

let indexPromise;
export function getIndex() {
  indexPromise ??= archive('index.json').catch(() => null);
  return indexPromise;
}

function scoreboardURL(league, { season, seasonType, week } = {}) {
  const p = new URLSearchParams();
  if (league === 'cfb') { p.set('groups', '80'); p.set('limit', '300'); }
  if (week != null) p.set('week', week);
  if (seasonType != null) p.set('seasontype', seasonType);
  if (season != null) p.set('dates', season);
  return `${SITE}/${LEAGUES[league].sport}/scoreboard?${p}`;
}

// Returns { data, source: 'live'|'archive', updated }.
export async function getScoreboard(league, opts = {}) {
  const index = await getIndex();
  const cur = index?.[league]?.current;
  const isCurrent = opts.week == null || !cur
    || (opts.week === cur.week && (opts.seasonType ?? 2) === cur.type && (opts.season == null || opts.season === index[league].season));
  const fromArchive = async () => {
    const season = opts.season ?? index?.[league]?.season;
    const type = opts.seasonType ?? cur?.type ?? 2;
    const week = opts.week ?? cur?.week;
    if (!season || week == null) throw new Error('no archive');
    const file = await archive(`${league}/${season}/${weekFile(type, week)}`);
    return { data: file, source: 'archive', updated: file.updated };
  };
  const fromLive = async () => {
    const raw = await getJSON(scoreboardURL(league, opts), { ttl: isCurrent ? 15_000 : 300_000 });
    return { data: normalizeScoreboard(raw, league), source: 'live', updated: new Date().toISOString() };
  };
  // Past weeks prefer the archive (cheap, stable); the current week prefers live.
  const order = isCurrent ? [fromLive, fromArchive] : [fromArchive, fromLive];
  let lastErr;
  for (const fn of order) {
    try { return await fn(); } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

export async function getStandings(league) {
  try {
    const url = `${V2}/${LEAGUES[league].sport}/standings${league === 'cfb' ? '?group=80' : ''}`;
    const raw = await getJSON(url, { ttl: 300_000 });
    const groups = league === 'nfl' ? await getJSON(`${SITE}/nfl/groups`, { ttl: 86_400_000 }) : null;
    const data = normalizeStandings(raw, league, groups);
    if (!data.groups.length) throw new Error('empty standings');
    return { data, source: 'live', updated: new Date().toISOString() };
  } catch {
    const file = await archive(`${league}/standings.json`);
    return { data: file, source: 'archive', updated: file.updated };
  }
}

export async function getCurrentRanking() {
  try {
    const raw = await getJSON(`${SITE}/college-football/rankings`, { ttl: 300_000 });
    const ap = normalizeRanking(pickAP(raw));
    if (!ap?.ranks.length) throw new Error('no AP poll');
    return { data: ap, source: 'live', updated: new Date().toISOString() };
  } catch {
    const index = await getIndex();
    const list = index?.cfb?.rankings || [];
    const last = list[list.length - 1];
    if (!last) throw new Error('No rankings available');
    const file = await archive(`cfb/${index.cfb.season}/rankings/${last.file}`);
    return { data: file, source: 'archive', updated: file.updated };
  }
}

// Every archived AP poll of a season, oldest first. Adds the live poll when it is newer.
export async function getRankingHistory(season) {
  const index = await getIndex();
  season ??= index?.cfb?.season;
  const list = index?.cfb?.season === season ? index.cfb.rankings || [] : [];
  const polls = (await Promise.all(
    list.map((r) => archive(`cfb/${season}/rankings/${r.file}`, 600_000).catch(() => null)),
  )).filter(Boolean);
  try {
    const { data: live } = await getCurrentRanking();
    const key = (p) => `${p.seasonType}-${p.week}`;
    if (live && (!season || live.season === season) && !polls.some((p) => key(p) === key(live))) polls.push(live);
  } catch { /* archive only */ }
  polls.sort((a, b) => (a.seasonType - b.seasonType) || (a.week - b.week));
  return polls;
}

export async function getTeamSchedule(league, id) {
  try {
    const raw = await getJSON(`${SITE}/${LEAGUES[league].sport}/teams/${id}/schedule`, { ttl: 60_000 });
    const data = normalizeSchedule(raw, league);
    if (!data.games.length) throw new Error('empty schedule');
    return { data, source: 'live', updated: new Date().toISOString() };
  } catch {
    // Rebuild the schedule from every archived week of the season.
    const index = await getIndex();
    const info = index?.[league];
    if (!info) throw new Error('No schedule available');
    const weeks = await Promise.all(info.weeks.map((w) => archive(`${league}/${info.season}/${w.file}`, 600_000).catch(() => null)));
    const games = weeks.filter(Boolean).flatMap((w) => w.games).filter((g) => g.home.id === id || g.away.id === id);
    const g0 = games[0];
    const team = g0 ? (g0.home.id === id ? g0.home : g0.away) : { id };
    return { data: { team: { ...team, record: '', standing: '' }, games }, source: 'archive', updated: info.updated };
  }
}
