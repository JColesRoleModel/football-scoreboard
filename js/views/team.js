// Team page: season schedule and results, record, conference standing, AP rank history.

import { getTeamSchedule, getStandings, getRankingHistory } from '../api.js';
import { esc, logo, teamHref, sourceNote, skeletonTable, emptyState, fmtDate, fmtKickoff } from '../ui.js';
import { statusText } from './scoreboard.js';

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function resultHTML(g, me, opp) {
  const s = g.status;
  if (s.state === 'pre' || s.postponed) return `<span class="t">${esc(s.postponed ? statusText(g) : fmtKickoff(g.date))}</span>`;
  const score = `${me.score ?? '-'}-${opp.score ?? '-'}`;
  if (s.state === 'in') return `<span class="w">${esc(statusText(g))}</span> ${score}`;
  const cls = me.winner ? 'w' : opp.winner ? 'l' : 't';
  const letter = me.winner ? 'W' : opp.winner ? 'L' : 'T';
  return `<span class="${cls}">${letter}</span> ${score}${s.ot ? ' OT' : ''}`;
}

function recordFrom(games, id) {
  let w = 0, l = 0, t = 0;
  for (const g of games) {
    if (g.status.state !== 'post') continue;
    const me = g.home.id === id ? g.home : g.away;
    const opp = me === g.home ? g.away : g.home;
    if (me.winner) w++; else if (opp.winner) l++; else t++;
  }
  return `${w}-${l}${t ? `-${t}` : ''}`;
}

export async function render(el, route, ctx) {
  const { league, id } = route;
  el.innerHTML = `<div id="note"></div><div id="body">${skeletonTable(10)}</div>`;

  const [res, st, polls] = await Promise.all([
    getTeamSchedule(league, id).catch(() => null),
    getStandings(league).catch(() => null),
    league === 'cfb' ? getRankingHistory().catch(() => []) : [],
  ]);
  if (!ctx.isCurrent()) return;
  if (!res) {
    el.querySelector('#body').innerHTML = emptyState('This team is unavailable right now', 'ESPN could not be reached and the saved archive has no games for this team yet.');
    return;
  }

  const { team, games } = res.data;
  games.sort((a, b) => new Date(a.date) - new Date(b.date));

  let group = null, pos = 0, row = null;
  for (const g of st?.data?.groups || []) {
    const i = g.teams.findIndex((t) => t.id === id);
    if (i >= 0) { group = g; pos = i + 1; row = g.teams[i]; break; }
  }
  const name = team.display || row?.display || team.name || 'Team';
  const teamLogo = team.logo || row?.logo;
  const record = team.record || row?.overall || recordFrom(games, id);
  const standing = group ? `${ordinal(pos)} in ${group.name}` : team.standing;
  const confRec = league === 'cfb' ? row?.conf : row?.div;

  const history = polls.map((p) => ({ p, rank: p.ranks.find((r) => r.team.id === id)?.rank ?? null }));
  const curRank = history.at(-1)?.rank;

  document.title = `${name} · Football Scoreboard`;

  const facts = [
    `<span>Record <b>${esc(record)}</b></span>`,
    confRec ? `<span>${league === 'cfb' ? 'Conf' : 'Div'} <b>${esc(confRec)}</b></span>` : '',
    standing ? `<span>${esc(standing)}</span>` : '',
    curRank ? `<span>AP <b class="rank">#${curRank}</b></span>` : '',
  ].filter(Boolean).join('');

  const sched = games.map((g) => {
    const home = g.home.id === id;
    const me = home ? g.home : g.away;
    const opp = home ? g.away : g.home;
    return `<div class="sched-row${g.status.state === 'in' ? ' live' : ''}">
      <span class="when">${esc(fmtDate(g.date))}${g.week && g.seasonType === 2 ? `<br>Wk ${g.week}` : ''}</span>
      <a href="${teamHref(league, opp.id)}" aria-hidden="true" tabindex="-1">${logo(opp.logo, opp.abbr, 24)}</a>
      <a class="opp" href="${teamHref(league, opp.id)}"><span class="at">${home ? 'vs' : '@'}</span>${opp.rank ? `<span class="rank">${opp.rank}</span> ` : ''}${esc(league === 'cfb' ? opp.name || opp.short : opp.short || opp.name)}${g.note ? ` <span class="sub" style="color:var(--violet);font-size:11px">${esc(g.note)}</span>` : ''}</a>
      <span class="res">${resultHTML(g, me, opp)}</span>
    </div>`;
  }).join('');

  const ranks = league === 'cfb' && history.length
    ? `<section class="section"><div class="section-head"><h2>AP rank history</h2></div>
        <div class="glass rank-strip">${history.map(({ p, rank }) => `<div class="wk"><span>${p.seasonType === 3 ? 'Final' : p.week === 1 ? 'Pre' : `W${p.week}`}</span>${rank ? `<b>${rank}</b>` : '<b class="nr">NR</b>'}</div>`).join('')}</div>
      </section>` : '';

  el.querySelector('#note').innerHTML = sourceNote(res);
  el.querySelector('#body').innerHTML = `
    <div class="glass team-hero">
      ${logo(teamLogo, team.abbr || row?.abbr, 72)}
      <div style="min-width:0"><h1>${esc(name)}</h1><div class="facts">${facts}</div></div>
    </div>
    <section class="section"><div class="section-head"><h2>Schedule</h2></div>
      ${games.length ? `<div class="glass">${sched}</div>` : emptyState('No games found for this season yet')}
    </section>
    ${ranks}`;
  return () => { document.title = 'Football Scoreboard'; };
}
