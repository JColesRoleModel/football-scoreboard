// Standings: CFB by conference, NFL by division.

import { getStandings, getCurrentRanking } from '../api.js';
import { cfbConfRank } from '../normalize.js';
import { esc, logo, teamHref, sourceNote, skeletonTable, emptyState, setChips, collapsible } from '../ui.js';
import { favoriteIds } from '../prefs.js';

function table(group, league, apRank) {
  const nfl = league === 'nfl';
  const favs = favoriteIds(league);
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
      return `<tr${favs.has(t.id) ? ' class="fav"' : ''}>
        <td class="team"><a href="${teamHref(league, t.id)}"><span class="pos">${i + 1}</span>${logo(t.logo, t.abbr, 22)}${rank ? `<span class="rank">${rank}</span>` : ''}<span class="nm">${esc(league === 'cfb' ? t.name || t.short : t.short || t.name)}</span>${favs.has(t.id) ? '<span class="fav-star">★</span>' : ''}</a></td>
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

  // Conferences and divisions with your teams come first.
  const favs = favoriteIds(league);
  const hasFav = (g) => (g.teams.some((t) => favs.has(t.id)) ? 0 : 1);
  let groups = [...res.data.groups];
  if (league === 'cfb') {
    groups.sort((a, b) => hasFav(a) - hasFav(b) || cfbConfRank(a.id) - cfbConfRank(b.id) || a.name.localeCompare(b.name));
  } else {
    groups.sort((a, b) => hasFav(a) - hasFav(b));
  }

  const groupHTML = (g) => collapsible({
    key: `standings:${league}:${g.id}`,
    id: `st-${g.id}`,
    head: `${logo(g.logo, g.abbr, 30)}<h2>${esc(g.name)}</h2>`,
    body: g.divisions ? g.divisions.map((d) => `<h3 class="div-title">${esc(d.name)}</h3>${table({ teams: d.teams }, league, apRank)}`).join('') : table(g, league, apRank),
  });

  let html = '';
  if (league === 'nfl') {
    const confs = ['AFC', 'NFC'].map((c) => ({ c, groups: groups.filter((g) => g.conf === c) }))
      .sort((a, b) => Math.min(...a.groups.map(hasFav)) - Math.min(...b.groups.map(hasFav)));
    for (const { c, groups: gs } of confs) {
      if (!gs.length) continue;
      html += collapsible({
        key: `standings:nfl:conf-${c}`,
        id: `st-${c}`,
        level: 'conf',
        head: `${logo(gs[0].logo, c, 34)}<h2 class="conf-title">${esc(c)}</h2>`,
        body: gs.map(groupHTML).join(''),
      });
    }
  } else {
    html = groups.map(groupHTML).join('');
  }
  el.querySelector('#body').innerHTML = `<div class="standings-grid">${html}</div>`;
  setChips(groups.map((g) => ({ target: `st-${g.id}`, label: league === 'nfl' ? g.name : g.abbr, logo: g.logo, abbr: g.abbr })));
}
