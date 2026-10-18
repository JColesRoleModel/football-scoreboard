// Live scoreboard: week picker, games grouped by conference (CFB) or division (NFL),
// and in-place auto-refresh while games are live.

import { getScoreboard, getStandings, getIndex } from '../api.js';
import { confLogo } from '../normalize.js';
import {
  esc, logo, teamHref, sourceNote, fmtKickoff, skeletonCards, emptyState, setChips,
} from '../ui.js';

// Power conferences first, independents last; everything else alphabetical in between.
const CFB_CONF_ORDER = ['8', '5', '4', '1', '9', '151', '17', '37', '15', '12'];
const CFB_INDEPENDENTS = '18';

export function statusText(g) {
  const s = g.status;
  if (s.postponed) return s.shortDetail || 'Postponed';
  if (s.state === 'pre') return fmtKickoff(g.date);
  if (s.state === 'post') return /^final/i.test(s.shortDetail) ? s.shortDetail : s.ot ? 'Final/OT' : 'Final';
  if (/HALFTIME/.test(s.name)) return 'Halftime';
  const q = s.period > 4 ? (s.period === 5 ? 'OT' : `${s.period - 4}OT`) : `Q${s.period}`;
  if (/END_PERIOD/.test(s.name)) return `End of ${q}`;
  return `${q} ${s.clock}`.trim();
}

export function isUpset(g) {
  if (g.status.state !== 'post') return false;
  const w = g.home.winner ? g.home : g.away.winner ? g.away : null;
  if (!w) return false;
  const l = w === g.home ? g.away : g.home;
  return !!l.rank && (!w.rank || w.rank > l.rank);
}

function sideHTML(g, side, league, fbsConfs) {
  const t = g[side];
  const decided = g.status.state === 'post';
  const cls = decided ? (t.winner ? 'win' : 'lose') : '';
  const fcs = league === 'cfb' && fbsConfs && !fbsConfs.has(t.confId) ? '<span class="tag fcs">FCS</span>' : '';
  const rec = [t.record, league === 'cfb' && t.confRecord ? `(${t.confRecord})` : ''].filter(Boolean).join(' ');
  return `<div class="side ${cls}">
    <a href="${teamHref(league, t.id)}" aria-hidden="true" tabindex="-1">${logo(t.logo, t.abbr)}</a>
    <div class="who">
      <span class="nm">${t.rank ? `<span class="rank">${t.rank}</span>` : ''}<a href="${teamHref(league, t.id)}">${esc(t.short || t.name)}</a>${fcs}</span>
      ${rec ? `<span class="rec">${esc(rec)}</span>` : ''}
    </div>
    <span class="score">${t.score ?? ''}</span>
  </div>`;
}

const gameSig = (g) => [statusText(g), g.home.score, g.away.score, g.home.winner, g.away.winner, g.home.rank, g.away.rank, g.tv, g.note].join('|');

export function gameCard(g, league, fbsConfs) {
  const live = g.status.state === 'in';
  const upset = league === 'cfb' && isUpset(g);
  return `<article class="glass game${live ? ' live' : ''}" data-id="${esc(g.id)}" data-sig="${esc(gameSig(g))}">
    <div class="game-meta">
      <span class="status">${live ? '<span class="pulse" aria-hidden="true"></span>' : ''}${esc(statusText(g))}${upset ? ' <span class="tag upset">Upset</span>' : ''}</span>
      <span class="tv">${esc(g.tv)}</span>
    </div>
    ${sideHTML(g, 'away', league, fbsConfs)}
    ${sideHTML(g, 'home', league, fbsConfs)}
    ${g.note ? `<div class="game-note">${esc(g.note)}</div>` : ''}
  </article>`;
}

function byKickoff(a, b) {
  return new Date(a.date) - new Date(b.date);
}

// CFB: one section per FBS conference involved in each game, ordered by conference standings.
function groupCFB(games, standings) {
  const confs = new Map();
  for (const c of standings?.groups || []) {
    confs.set(c.id, { ...c, pos: new Map(c.teams.map((t) => [t.id, t.order])), games: [] });
  }
  const known = confs.size > 0;
  for (const g of games) {
    let ids = [...new Set([g.away.confId, g.home.confId])].filter((id) => id && (!known || confs.has(id)));
    if (!ids.length) ids = ['other'];
    for (const id of ids) {
      if (!confs.has(id)) confs.set(id, { id, name: id === 'other' ? 'Other games' : `Conference ${id}`, abbr: id === 'other' ? 'Other' : id, logo: id === 'other' ? '' : confLogo('cfb', id), pos: new Map(), games: [] });
      confs.get(id).games.push(g);
    }
  }
  const rank = (id) => (id === CFB_INDEPENDENTS ? 1e3 : id === 'other' ? 1e4 : CFB_CONF_ORDER.includes(id) ? CFB_CONF_ORDER.indexOf(id) : 100);
  const sections = [...confs.values()].filter((c) => c.games.length);
  sections.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
  for (const c of sections) {
    const best = (g) => Math.min(c.pos.get(g.home.id) ?? 999, c.pos.get(g.away.id) ?? 999);
    c.games.sort((a, b) => best(a) - best(b) || byKickoff(a, b));
  }
  return [{ title: null, sections }];
}

// NFL: AFC/NFC, then divisions in standings order. A game shows under each division involved.
function groupNFL(games, standings) {
  const divs = (standings?.groups || []).map((d) => ({ ...d, pos: new Map(d.teams.map((t) => [t.id, t.order])), games: [] }));
  const divOf = new Map();
  for (const d of divs) for (const t of d.teams) divOf.set(t.id, d);
  const other = { id: 'other', name: 'Games', abbr: 'NFL', logo: confLogo('nfl', 'nfl'), conf: '', pos: new Map(), games: [] };
  for (const g of games) {
    const ds = [...new Set([divOf.get(g.away.id), divOf.get(g.home.id)])].filter(Boolean);
    if (!ds.length) other.games.push(g);
    for (const d of ds) d.games.push(g);
  }
  for (const d of [...divs, other]) {
    const best = (g) => Math.min(d.pos.get(g.home.id) ?? 99, d.pos.get(g.away.id) ?? 99);
    d.games.sort((a, b) => best(a) - best(b) || byKickoff(a, b));
  }
  const out = [];
  for (const conf of ['AFC', 'NFC']) {
    const sections = divs.filter((d) => d.conf === conf && d.games.length);
    if (sections.length) out.push({ title: conf, logo: confLogo('nfl', conf), sections });
  }
  if (other.games.length) out.push({ title: null, sections: [other] });
  return out;
}

function flatSection(games, title, league) {
  return [{ title: null, sections: [{ id: 'all', name: title, abbr: title, logo: confLogo(league, league === 'nfl' ? 'nfl' : ''), games: [...games].sort(byKickoff) }] }];
}

function weekOptions(calendar) {
  const opts = [];
  for (const t of calendar?.types || []) {
    if (t.type > 3) continue;
    for (const w of t.weeks) {
      const label = t.type === 2 ? w.label : t.type === 1 ? `Preseason: ${w.label}` : w.label;
      opts.push({ key: `${t.type}-${w.value}`, type: t.type, week: w.value, label });
    }
  }
  return opts;
}

function sectionsHTML(groups, league, fbsConfs) {
  return groups.map((grp) => `
    ${grp.title ? `<h2 class="conf-title" id="conf-${esc(grp.title)}">${esc(grp.title)}</h2>` : ''}
    ${grp.sections.map((s) => `
      <section class="section" id="sec-${esc(s.id)}">
        <div class="section-head">${s.logo !== undefined ? logo(s.logo, s.abbr, 30) : ''}<h2>${esc(s.name)}</h2></div>
        <div class="grid">${s.games.map((g) => gameCard(g, league, fbsConfs)).join('')}</div>
      </section>`).join('')}`).join('');
}

export async function render(el, route, ctx) {
  const { league } = route;
  const [type, week] = (route.week || '').split('-').map(Number);
  const opts = Number.isFinite(week) ? { seasonType: type, week } : {};

  el.innerHTML = `<div class="toolbar"><h1>${league === 'nfl' ? 'NFL' : 'College Football'}</h1><div class="week-picker" id="wp"></div></div><div id="note"></div><div id="games">${skeletonCards()}</div>`;

  const index = await getIndex();
  const standingsP = getStandings(league).catch(() => null);
  let res;
  try {
    res = await getScoreboard(league, opts);
  } catch {
    if (!ctx.isCurrent()) return;
    el.querySelector('#games').innerHTML = emptyState('Scores are unavailable right now', 'ESPN could not be reached and there is no saved snapshot for this week yet. Try again in a few minutes.');
    return;
  }
  const standings = (await standingsP)?.data;
  if (!ctx.isCurrent()) return;

  const data = res.data;
  const calendar = data.calendar || (index?.[league] ? { types: index[league].calendar, current: index[league].current } : null);
  const curType = opts.seasonType ?? data.seasonType ?? calendar?.current?.type;
  const curWeek = opts.week ?? data.week ?? calendar?.current?.week;
  const weeks = weekOptions(calendar);
  const curKey = `${curType}-${curWeek}`;
  const i = weeks.findIndex((w) => w.key === curKey);
  const go = (w) => { if (w) location.hash = `#/scores/${league}/${w.key}`; };

  const wp = el.querySelector('#wp');
  if (weeks.length) {
    wp.innerHTML = `
      <button class="icon-btn" id="prev" aria-label="Previous week" ${i <= 0 ? 'disabled' : ''}>‹</button>
      <label class="visually-hidden" for="wk">Week</label>
      <select id="wk">${weeks.map((w) => `<option value="${w.key}" ${w.key === curKey ? 'selected' : ''}>${esc(w.label)}</option>`).join('')}</select>
      <button class="icon-btn" id="next" aria-label="Next week" ${i < 0 || i >= weeks.length - 1 ? 'disabled' : ''}>›</button>`;
    wp.querySelector('#wk').addEventListener('change', (e) => go(weeks.find((w) => w.key === e.target.value)));
    wp.querySelector('#prev').addEventListener('click', () => go(weeks[i - 1]));
    wp.querySelector('#next').addEventListener('click', () => go(weeks[i + 1]));
  }

  const fbsConfs = league === 'cfb' && standings?.groups?.length ? new Set(standings.groups.map((g) => g.id)) : null;

  const draw = (d) => {
    const games = d.games || [];
    if (!games.length) {
      setChips(null);
      return emptyState('No games this week', curType === 3 ? 'Postseason matchups appear here once they are set.' : 'This looks like an off week. Use the week picker to look around the season.');
    }
    let groups;
    if (curType !== 2 && curType !== 1) groups = flatSection(games, league === 'cfb' ? 'Bowls & Playoff' : 'Playoffs', league);
    else if (league === 'cfb') groups = groupCFB(games, standings);
    else if (standings?.groups?.length) groups = groupNFL(games, standings);
    else groups = flatSection(games, 'Games', league);

    const chips = groups.flatMap((g) => g.sections).filter((s) => s.id !== 'all')
      .map((s) => ({ target: `sec-${s.id}`, label: league === 'nfl' ? s.name.replace(/^(AFC|NFC) /, '$1 ') : s.abbr, logo: s.logo, abbr: s.abbr }));
    setChips(chips.length > 1 ? chips : null);

    const byes = (d.byes || []).length
      ? `<p class="notice">On bye: ${d.byes.map((t) => `<a href="${teamHref(league, t.id)}" title="${esc(t.display)}">${logo(t.logo, t.abbr, 20)}</a>`).join('')}</p>`
      : '';
    return byes + sectionsHTML(groups, league, fbsConfs);
  };

  el.querySelector('#note').innerHTML = sourceNote(res);
  el.querySelector('#games').innerHTML = draw(data);

  // Auto-refresh the current week in place: swap only the cards that changed,
  // so the page keeps its scroll position.
  const isCurrentWeek = !Number.isFinite(week) || (calendar?.current && curType === calendar.current.type && curWeek === calendar.current.week);
  if (!isCurrentWeek) return;

  let timer = 0;
  let last = data;
  const nextDelay = (games) => {
    if (games.some((g) => g.status.state === 'in')) return 30_000;
    const soon = games.some((g) => g.status.state === 'pre' && new Date(g.date) - Date.now() < 20 * 60_000 && !g.status.postponed);
    return soon ? 60_000 : 5 * 60_000;
  };
  const tick = async () => {
    if (!document.hidden) {
      try {
        const r = await getScoreboard(league, opts);
        if (!ctx.isCurrent()) return;
        el.querySelector('#note').innerHTML = sourceNote(r);
        const fresh = new Map(r.data.games.map((g) => [g.id, g]));
        const sameSet = r.data.games.length === last.games.length && last.games.every((g) => fresh.has(g.id));
        if (!sameSet) {
          const y = window.scrollY;
          el.querySelector('#games').innerHTML = draw(r.data);
          window.scrollTo(0, y);
        } else {
          for (const card of el.querySelectorAll('.game[data-id]')) {
            const g = fresh.get(card.dataset.id);
            if (card.dataset.sig !== gameSig(g)) card.outerHTML = gameCard(g, league, fbsConfs);
          }
        }
        last = r.data;
      } catch { /* keep showing what we have */ }
    }
    timer = setTimeout(tick, nextDelay(last.games));
  };
  timer = setTimeout(tick, nextDelay(data.games));
  return () => clearTimeout(timer);
}
