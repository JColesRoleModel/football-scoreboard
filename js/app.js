// Hash router and shell (league toggle, tabs). Each view renders into <main> and may
// return a cleanup function that runs when the route changes.
//
// Routes:
//   #/scores/{league}[/{seasonType}-{week}]
//   #/standings/{league}
//   #/poll[/{seasonType}-{week}]
//   #/team/{league}/{id}
//   #/my

import { startStarfield } from './starfield.js';
import { setChips } from './ui.js';
import * as scoreboard from './views/scoreboard.js';
import * as standings from './views/standings.js';
import * as poll from './views/poll.js';
import * as team from './views/team.js';
import * as myteams from './views/myteams.js';
import { watch } from './alerts.js';

const view = document.getElementById('view');
let cleanup = null;
let renderId = 0;

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

function parse() {
  const [tab = 'scores', ...rest] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const saved = store.get('league', 'nfl');
  if (tab === 'poll') return { tab, league: 'cfb', week: rest[0] };
  if (tab === 'team') return { tab, league: rest[0] === 'nfl' ? 'nfl' : 'cfb', id: rest[1] };
  if (tab === 'my') return { tab, league: saved };
  const league = rest[0] === 'cfb' || rest[0] === 'nfl' ? rest[0] : saved;
  return { tab: tab === 'standings' ? 'standings' : 'scores', league, week: rest[1] };
}

function updateShell(route) {
  store.set('league', route.league);
  for (const b of document.querySelectorAll('.league-toggle button')) {
    b.setAttribute('aria-pressed', String(b.dataset.league === route.league));
  }
  for (const a of document.querySelectorAll('.tabs a')) {
    const t = a.dataset.tab;
    a.href = t === 'poll' || t === 'my' ? `#/${t}` : `#/${t}/${route.league}`;
    a.hidden = a.hasAttribute('data-cfb-only') && route.league !== 'cfb';
    if (t === route.tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.querySelector('.brand').href = `#/scores/${route.league}`;
}

async function route() {
  const r = parse();
  updateShell(r);
  cleanup?.();
  cleanup = null;
  setChips(null);
  const id = ++renderId;
  const views = { scores: scoreboard, standings, poll, team, my: myteams };
  const ctx = { isCurrent: () => id === renderId };
  try {
    const c = await views[r.tab].render(view, r, ctx);
    if (id === renderId) cleanup = typeof c === 'function' ? c : null;
    else if (typeof c === 'function') c();
  } catch (e) {
    console.error(e);
    if (id === renderId) view.innerHTML = `<div class="glass empty"><h3>Something went wrong</h3><p>${String(e.message || e).replace(/[<>&]/g, '')}</p></div>`;
  }
}

document.querySelector('.league-toggle').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-league]');
  if (!b) return;
  const r = parse();
  const tab = r.tab === 'standings' ? 'standings' : 'scores';
  location.hash = `#/${tab}/${b.dataset.league}`;
});

window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
});

// Keep the sticky header height in a CSS variable for scroll offsets.
const top = document.querySelector('.topbar');
new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${top.offsetHeight}px`)).observe(top);

startStarfield(document.getElementById('stars'));
route();
watch();

// Offline support and installability. Relative path so it works under /football-scoreboard/.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
