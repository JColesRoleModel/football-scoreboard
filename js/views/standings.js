// Standings: CFB by conference, NFL by division.

import { getStandings, getCurrentRanking } from '../api.js';
import { cfbConfRank } from '../normalize.js';
import { esc, logo, teamHref, sourceNote, skeletonTable, emptyState, setChips } from '../ui.js';

function table(group, league, apRank) {
  const nfl = league === 'nfl';
  return `<div class="glass table-card"><table class="table">
    <colgroup><col class="c-team"><col class="c-wide"><col class="c-wide">${nfl ? '<col class="c-num hide-sm">' : ''}<col class="c-num hide-sm"></colgroup>
    <thead><tr>
      <th scope="col">Team</th>
      <th scope="col">${nfl ? 'W-L' : 'Conf'}</th>
      <th scope="col">${nfl ? 'Div' : 'Overall'}</th>
      ${nfl ? '<th scope="col" class="hide-sm">Pct</th>' : ''}
      <th scope="col" class="hide-sm">Strk</th>
    </tr></thead>
    <tbody>${group.teams.map((t, i) => {
      const rank = apRank?.get(t.id);
      return `<tr>
        <td class="team"><a href="${teamHref(league, t.id)}"><span class="pos">${i + 1}</span>${logo(t.logo, t.abbr, 22)}${rank ? `<span class="rank">${rank}</span>` : ''}<span class="nm">${esc(t.short || t.name)}</span></a></td>
        <td>${esc(nfl ? t.overall : t.conf || '-')}</td>
        <td>${esc(nfl ? t.div || '-' : t.overall)}</td>
        ${nfl ? `<td class="hide-sm">${t.pct != null ? Number(t.pct).toFixed(3).replace(/^0/, '') : '-'}</td>` : ''}
        <td class="hide-sm">${esc(t.streak || '-')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

export async function render(el, route, ctx) {
  const { league } = route;
  el.innerHTML = `<div class="toolbar"><h1>${league === 'nfl' ? 'NFL Standings' : 'FBS Standings'}</h1></div><div id="note"></div><div id="body">${skeletonTable()}</div>`;

  const [res, ap] = await Promise.all([
    getStandings(league).catch(() => null),
    league === 'cfb' ? getCurrentRanking().catch(() => null) : null,
  ]);
  if (!ctx.isCurrent()) return;
  if (!res?.data?.groups?.length) {
    el.querySelector('#body').innerHTML = emptyState('Standings are unavailable right now', 'ESPN could not be reached and no saved standings exist yet.');
    return;
  }
  el.querySelector('#note').innerHTML = sourceNote(res);
  const apRank = ap?.data ? new Map(ap.data.ranks.map((r) => [r.team.id, r.rank])) : null;

  let groups = res.data.groups;
  if (league === 'cfb') {
    groups = [...groups].sort((a, b) => cfbConfRank(a.id) - cfbConfRank(b.id) || a.name.localeCompare(b.name));
  }

  let html = '';
  let conf = '';
  for (const g of groups) {
    if (league === 'nfl' && g.conf !== conf) {
      conf = g.conf;
      html += `<h2 class="conf-title" id="st-${esc(conf)}">${esc(conf)}</h2>`;
    }
    html += `<section class="section" id="st-${esc(g.id)}">
      <div class="section-head">${logo(g.logo, g.abbr, 30)}<h2>${esc(g.name)}</h2></div>
      ${table(g, league, apRank)}
    </section>`;
  }
  el.querySelector('#body').innerHTML = `<div class="standings-grid">${html}</div>`;
  setChips(groups.map((g) => ({ target: `st-${g.id}`, label: league === 'nfl' ? g.name : g.abbr, logo: g.logo, abbr: g.abbr })));
}
