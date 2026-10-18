// My Teams: favorite teams saved on this device, their current game, team alerts and install tips.

import { getScoreboard, getStandings } from '../api.js';
import {
  favorites, toggleFavorite, isFavorite, onPrefsChange, teamAlerts, setTeamAlerts, ALERT_TYPES, alertTypesFor,
} from '../prefs.js';
import {
  ensurePermission, notifyPermission, isStandalone, isIOS, registerGames, watch,
} from '../alerts.js';
import { esc, logo, teamHref, skeletonTable } from '../ui.js';
import { statusText } from './scoreboard.js';

const LEAGUE_LABEL = { nfl: 'NFL', cfb: 'CFB' };

function gameLine(g, id) {
  if (!g) return 'No game this week';
  const home = g.home.id === id;
  const opp = home ? g.away : g.home;
  const me = home ? g.home : g.away;
  const vs = `${home ? 'vs' : '@'} ${opp.rank ? `${opp.rank} ` : ''}${opp.short || opp.name}`;
  if (g.status.state === 'pre') return `${vs} · ${statusText(g)}`;
  const score = `${me.score ?? 0}-${opp.score ?? 0}`;
  if (g.status.state === 'in') return `${vs} · ${score} · ${statusText(g)}`;
  return `${vs} · ${me.winner ? 'W' : opp.winner ? 'L' : 'T'} ${score}`;
}

export async function render(el, route, ctx) {
  el.innerHTML = `<div id="my"><div class="toolbar"><h1>My Teams</h1></div>
    <div id="favs">${skeletonTable(3)}</div>
    <section class="section"><div class="section-head"><h2>Add a team</h2></div>
      <input class="search" id="q" type="search" placeholder="Search NFL and college teams" autocomplete="off" aria-label="Search teams">
      <div class="glass search-results" id="results" hidden></div>
    </section>
    <section class="section"><div class="section-head"><h2>Alerts for my teams</h2></div>
      <div class="glass settings" id="alerts"></div>
    </section>
    <div id="install"></div></div>`;
  // Listen on this view's own root so handlers go away with it.
  const root = el.querySelector('#my');

  // Team directory for search, from both leagues' standings.
  const teamsP = Promise.all(['nfl', 'cfb'].map((l) => getStandings(l)
    .then((r) => r.data.groups.flatMap((g) => g.teams.map((t) => ({ ...t, league: l, group: g.abbr || g.name }))))
    .catch(() => []))).then((x) => x.flat());

  // Current week's games for each league with a favorite.
  const games = {};
  async function loadGames() {
    const leagues = [...new Set(favorites().map((f) => f.league))];
    await Promise.all(leagues.map(async (l) => {
      try {
        const { data } = await getScoreboard(l);
        games[l] = data.games;
        registerGames(l, data.games);
      } catch { games[l] = []; }
    }));
  }

  const drawFavs = () => {
    const favs = favorites();
    const host = el.querySelector('#favs');
    if (!favs.length) {
      host.innerHTML = '<div class="glass empty"><h3>No favorite teams yet</h3><p>Search below, or tap the star on any team page. Your teams are saved on this device and show first on the scoreboard.</p></div>';
      return;
    }
    host.innerHTML = `<div class="glass">${favs.map((f) => {
      const g = (games[f.league] || []).find((x) => x.home.id === f.id || x.away.id === f.id);
      const bell = g && g.status.state !== 'post' ? `<button type="button" class="bell${alertTypesFor(f.league, g) ? ' on' : ''}" data-league="${f.league}" data-game="${esc(g.id)}" aria-label="Alerts for this game"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1112 0v5l2 2H4l2-2zM10 20a2 2 0 004 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` : '';
      return `<div class="myteam">
        <a href="${teamHref(f.league, f.id)}" aria-hidden="true" tabindex="-1">${logo(f.logo, f.abbr, 40)}</a>
        <a href="${teamHref(f.league, f.id)}" style="min-width:0"><span class="nm">${esc(f.display || f.name)}</span><span class="sub">${LEAGUE_LABEL[f.league]} · ${esc(gameLine(g, f.id))}</span></a>
        <span style="display:flex;gap:8px;align-items:center">${bell}<button type="button" class="icon-x" data-remove="${f.league}:${esc(f.id)}" aria-label="Remove ${esc(f.display || f.name)}">✕</button></span>
      </div>`;
    }).join('')}</div>`;
  };

  const drawResults = async () => {
    const q = el.querySelector('#q').value.trim().toLowerCase();
    const box = el.querySelector('#results');
    if (q.length < 2) { box.hidden = true; return; }
    const all = await teamsP;
    if (!ctx.isCurrent()) return;
    const hits = all.filter((t) => `${t.display} ${t.abbr} ${t.name}`.toLowerCase().includes(q)).slice(0, 12);
    box.hidden = false;
    box.innerHTML = hits.length ? hits.map((t) => {
      const on = isFavorite(t.league, t.id);
      return `<button type="button" class="result" data-add="${t.league}:${esc(t.id)}">${logo(t.logo, t.abbr, 26)}<span>${esc(t.display || t.name)}</span><span class="lg">${LEAGUE_LABEL[t.league]} · ${esc(t.group)}</span><span class="add${on ? ' on' : ''}">${on ? '★ Saved' : '☆ Add'}</span></button>`;
    }).join('') : '<p class="install-tip">No teams match that search.</p>';
  };

  const drawAlerts = () => {
    const ta = teamAlerts();
    const perm = notifyPermission();
    const permLine = perm === 'granted' ? 'Notifications are allowed on this device.'
      : perm === 'denied' ? 'Notifications are blocked for this site in your browser settings. Alerts will only show inside the app.'
        : perm === 'unsupported' ? (isIOS() ? 'Add this site to your Home Screen to get notifications on iPhone.' : 'This browser does not support notifications.')
          : 'Notifications are not turned on yet.';
    el.querySelector('#alerts').innerHTML = `
      <label class="check"><input type="checkbox" id="ta-on" ${ta.enabled ? 'checked' : ''}><span><b>Alert me for every game my teams play</b><small>You can still set alerts for any single game with its bell.</small></span></label>
      ${ALERT_TYPES.map((t) => `<label class="check"><input type="checkbox" data-type="${t.key}" ${ta[t.key] ? 'checked' : ''} ${ta.enabled ? '' : 'disabled'}><span><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></span></label>`).join('')}
      <p class="sheet-hint">${esc(permLine)} Alerts arrive while the app is open or running in the background.</p>
      ${perm === 'default' ? '<div class="sheet-actions" style="justify-content:flex-start"><button type="button" class="btn primary" id="perm">Allow notifications</button></div>' : ''}`;
  };

  const drawInstall = () => {
    el.querySelector('#install').innerHTML = isStandalone() ? '' : `<section class="section"><div class="section-head"><h2>Install the app</h2></div>
      <div class="glass install-tip">${isIOS()
        ? 'In Safari, tap the Share button, then <b>Add to Home Screen</b>. The app opens full screen with its own icon, and alerts can reach you.'
        : 'Use your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>. The app opens full screen with its own icon.'}</div></section>`;
  };

  root.addEventListener('input', (e) => { if (e.target.id === 'q') drawResults(); });
  root.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) {
      const [league, id] = add.dataset.add.split(':');
      const t = (await teamsP).find((x) => x.league === league && x.id === id);
      if (t) toggleFavorite(league, t);
      return;
    }
    const rm = e.target.closest('[data-remove]');
    if (rm) {
      const [league, id] = rm.dataset.remove.split(':');
      toggleFavorite(league, { id });
      return;
    }
    if (e.target.id === 'perm') {
      await ensurePermission();
      drawAlerts();
    }
  });
  root.addEventListener('change', async (e) => {
    if (e.target.id === 'ta-on') {
      setTeamAlerts({ enabled: e.target.checked });
      if (e.target.checked) await ensurePermission();
      drawAlerts();
      watch();
    } else if (e.target.dataset.type) {
      setTeamAlerts({ [e.target.dataset.type]: e.target.checked });
    }
  });

  drawAlerts();
  drawInstall();
  await loadGames();
  if (!ctx.isCurrent()) return;
  drawFavs();

  return onPrefsChange(async (kind) => {
    if (kind === 'collapsed') return;
    drawFavs();
    drawResults();
    await loadGames();
    if (ctx.isCurrent()) drawFavs();
  });
}
