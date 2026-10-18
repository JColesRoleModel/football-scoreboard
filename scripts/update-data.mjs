#!/usr/bin/env node
// Archives ESPN scoreboards, standings and AP polls into /data.
// Run by .github/workflows/update-data.yml; also runnable locally with `node scripts/update-data.mjs`.
//
// - The first run backfills every completed week of the current season for both leagues.
// - Later runs refresh the current week, any week with unfinished games, standings and the AP poll.
// - A file is only rewritten when its content changed, so the workflow commits only real changes.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LEAGUES, normalizeScoreboard, normalizeStandings, normalizeRanking, pickAP,
} from '../js/normalize.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football';
const V2 = 'https://site.api.espn.com/apis/v2/sports/football';
const CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues';
const NOW = new Date();
const stamp = NOW.toISOString();

const log = (...a) => console.log(...a);

async function getJSON(url, tries = 3) {
  url = url.replace(/^http:/, 'https:');
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'football-scoreboard-archiver' } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i >= tries) throw new Error(`${url}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}

async function readJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

// Writes `obj` (plus an `updated` stamp) only when it differs from what is on disk.
// Returns the stored object either way.
async function writeIfChanged(rel, obj) {
  const path = join(DATA, rel);
  const old = await readJSON(path);
  if (old) {
    const { updated, ...rest } = old;
    if (JSON.stringify(rest) === JSON.stringify(obj)) return old;
  }
  const out = { ...obj, updated: stamp };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(out) + '\n');
  log(`  wrote data/${rel}`);
  return out;
}

const weekFile = (type, week) => `${type === 1 ? 'pre' : type === 3 ? 'post' : 'week'}-${week}.json`;

function scoreboardURL(league, season, type, week) {
  const p = new URLSearchParams({ dates: season, seasontype: type, week });
  if (league === 'cfb') { p.set('groups', '80'); p.set('limit', '300'); }
  return `${SITE}/${LEAGUES[league].sport}/scoreboard?${p}`;
}

const allFinal = (games) => games.every((g) => g.status.completed || g.status.postponed);

async function archiveLeague(league, prevIndex) {
  log(`\n== ${league.toUpperCase()} ==`);
  const curRaw = await getJSON(`${SITE}/${LEAGUES[league].sport}/scoreboard${league === 'cfb' ? '?groups=80&limit=300' : ''}`);
  const cur = normalizeScoreboard(curRaw, league);
  const { calendar } = cur;
  const season = calendar.season;
  log(`season ${season}, current type ${calendar.current.type} week ${calendar.current.week}`);

  const prev = prevIndex?.[league]?.season === season ? prevIndex[league] : null;
  const known = new Map((prev?.weeks || []).map((w) => [`${w.type}-${w.week}`, w]));
  const weeks = [];

  for (const t of calendar.types) {
    for (const w of t.weeks) {
      const key = `${t.type}-${w.value}`;
      const started = new Date(w.start) <= NOW;
      const isCurrent = t.type === calendar.current.type && w.value === calendar.current.week;
      if (!started && !isCurrent) continue;
      const rel = `${league}/${season}/${weekFile(t.type, w.value)}`;
      const existing = known.get(key);
      const onDisk = await readJSON(join(DATA, rel));
      // Refetch the current week, anything missing, and weeks that still have unfinished games.
      const needs = isCurrent || !onDisk || !existing?.final;
      let stored = onDisk;
      if (needs) {
        const raw = isCurrent && curRaw.week?.number === w.value ? curRaw : await getJSON(scoreboardURL(league, season, t.type, w.value));
        if (!raw) continue;
        const sb = normalizeScoreboard(raw, league);
        const { calendar: _c, ...body } = sb;
        stored = await writeIfChanged(rel, { ...body, season, seasonType: t.type, week: w.value, label: w.label });
      }
      if (!stored) continue;
      weeks.push({
        type: t.type, week: w.value, label: w.label, typeLabel: t.label,
        file: weekFile(t.type, w.value), games: stored.games.length,
        final: stored.games.length > 0 && allFinal(stored.games) && new Date(w.end) < NOW,
      });
    }
  }

  // Standings
  try {
    const raw = await getJSON(`${V2}/${LEAGUES[league].sport}/standings${league === 'cfb' ? '?group=80' : ''}`);
    const groups = league === 'nfl' ? await getJSON(`${SITE}/nfl/groups`) : null;
    const st = normalizeStandings(raw, league, groups);
    if (st.groups.length) await writeIfChanged(`${league}/standings.json`, st);
  } catch (e) { log(`standings failed: ${e.message}`); }

  const entry = {
    season,
    current: calendar.current,
    calendar: calendar.types,
    logo: calendar.logo,
    weeks,
  };
  if (league === 'cfb') entry.rankings = await archiveRankings(season, calendar, prev);
  return entry;
}

const teamCache = new Map();
async function resolveTeam(ref) {
  if (!ref?.$ref) return ref;
  if (!teamCache.has(ref.$ref)) teamCache.set(ref.$ref, getJSON(ref.$ref).catch(() => null));
  return (await teamCache.get(ref.$ref)) || { id: ref.$ref.match(/teams\/(\d+)/)?.[1] };
}

async function resolveRanks(list = []) {
  return Promise.all(list.map(async (r) => ({
    ...r,
    recordSummary: r.recordSummary || r.record?.summary || '',
    team: await resolveTeam(r.team),
  })));
}

async function corePoll(season, type, week) {
  const page = await getJSON(`${CORE}/college-football/seasons/${season}/types/${type}/weeks/${week}/rankings`);
  const refs = (page?.items || []).map((i) => i.$ref);
  const ref = refs.find((r) => /\/rankings\/1(\?|$)/.test(r)) || null;
  const candidates = ref ? [ref] : refs;
  for (const r of candidates) {
    const poll = await getJSON(r);
    if (poll && (poll.type === 'ap' || /AP/.test(poll.shortName || poll.name || ''))) {
      return {
        ...poll,
        ranks: await resolveRanks(poll.ranks),
        others: await resolveRanks(poll.others),
        droppedOut: await resolveRanks(poll.droppedOut),
        season: { year: season, type: { type } },
        occurrence: poll.occurrence || { number: week, displayValue: `Week ${week}` },
      };
    }
  }
  return null;
}

async function archiveRankings(season, calendar, prev) {
  const dir = `cfb/${season}/rankings`;
  const known = new Set((prev?.rankings || []).map((r) => r.file));
  const out = [];
  const fileFor = (type, week) => (type === 3 ? `final.json` : `week-${week}.json`);

  // Backfill weekly polls (core API) for every week that has started.
  for (const t of calendar.types.filter((x) => x.type === 2 || x.type === 3)) {
    const weeks = t.type === 3 ? [{ value: 1, start: t.weeks.at(-1)?.end }] : t.weeks;
    for (const w of weeks) {
      if (!w.start || new Date(w.start) > NOW) continue;
      const file = fileFor(t.type, w.value);
      const onDisk = await readJSON(join(DATA, dir, file));
      if (onDisk && known.has(file)) { out.push({ type: t.type, week: w.value, file, label: onDisk.label }); continue; }
      try {
        // The preseason poll sometimes lives under the preseason season type.
        const poll = (await corePoll(season, t.type, w.value)) || (t.type === 2 && w.value === 1 ? await corePoll(season, 1, 1) : null);
        if (!poll) continue;
        const stored = await writeIfChanged(`${dir}/${file}`, normalizeRanking(poll));
        out.push({ type: t.type, week: w.value, file, label: stored.label });
      } catch (e) { log(`rankings ${t.type}/${w.value} failed: ${e.message}`); }
    }
  }

  // The current poll from the site API (includes others receiving votes) overwrites its week.
  try {
    const ap = normalizeRanking(pickAP(await getJSON(`${SITE}/college-football/rankings`)));
    if (ap?.ranks.length && (!ap.season || ap.season === season)) {
      const type = ap.seasonType === 3 ? 3 : 2;
      const file = fileFor(type, ap.week);
      const stored = await writeIfChanged(`${dir}/${file}`, { ...ap, season, seasonType: type });
      const i = out.findIndex((r) => r.file === file);
      const row = { type, week: ap.week, file, label: stored.label };
      if (i >= 0) out[i] = row; else out.push(row);
    }
  } catch (e) { log(`current rankings failed: ${e.message}`); }

  out.sort((a, b) => a.type - b.type || a.week - b.week);
  return out;
}

async function main() {
  const indexPath = join(DATA, 'index.json');
  const prevIndex = await readJSON(indexPath);
  const index = {};
  let failed = 0;
  for (const league of Object.keys(LEAGUES)) {
    try {
      index[league] = await archiveLeague(league, prevIndex);
    } catch (e) {
      failed++;
      console.error(`${league} failed: ${e.message}`);
      if (prevIndex?.[league]) index[league] = prevIndex[league];
    }
  }
  await writeIfChanged('index.json', index);
  if (failed === Object.keys(LEAGUES).length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
