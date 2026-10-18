// "Live Now" strip at the top of the scores page: every live NFL and CFB game in one place,
// refreshed on its own whichever league or week is selected below it.

import { getScoreboard } from '../api.js';
import { registerGames } from '../alerts.js';
import { onPrefsChange } from '../prefs.js';
import { collapsible, fmtKickoff, esc } from '../ui.js';
import { gameCard } from './scoreboard.js';

const LEAGUES = ['nfl', 'cfb'];

async function fetchAll() {
  const out = await Promise.all(LEAGUES.map((l) => getScoreboard(l)
    .then((r) => r.data.games.map((g) => ({ g, league: l })))
    .catch(() => [])));
  return out.flat();
}

// Close games late in the game first, then by kickoff.
function liveOrder(a, b) {
  const late = (x) => -(x.g.status.period || 0);
  const margin = (x) => Math.abs((x.g.home.score || 0) - (x.g.away.score || 0));
  return late(a) - late(b) || margin(a) - margin(b) || new Date(a.g.date) - new Date(b.g.date);
}

export function mountLiveNow(host, ctx) {
  let timer = 0;
  let stopped = false;
  let items = [];

  const draw = () => {
    const live = items.filter((x) => x.g.status.state === 'in').sort(liveOrder);
    if (!live.length) {
      const next = items.filter((x) => x.g.status.state === 'pre' && !x.g.status.postponed)
        .sort((a, b) => new Date(a.g.date) - new Date(b.g.date))[0];
      host.innerHTML = next
        ? `<p class="live-idle"><span class="dot-idle" aria-hidden="true"></span>No games live right now. Next kickoff: ${esc(next.g.name)}, ${esc(fmtKickoff(next.g.date))}</p>`
        : '';
      return;
    }
    const y = window.scrollY;
    host.innerHTML = collapsible({
      key: 'scores:livenow',
      id: 'sec-live',
      cls: 'live-now',
      head: '<span class="sec-icon live"><span class="pulse" aria-hidden="true"></span></span><h2>Live Now</h2>'
        + `<span class="count">${live.length}</span>`,
      body: `<div class="grid">${live.map((x) => gameCard(x.g, x.league, null, true)).join('')}</div>`,
    });
    window.scrollTo(0, y);
  };

  const tick = async () => {
    if (stopped || !ctx.isCurrent()) return;
    if (!document.hidden) {
      items = await fetchAll();
      if (stopped || !ctx.isCurrent()) return;
      for (const l of LEAGUES) registerGames(l, items.filter((x) => x.league === l).map((x) => x.g));
      draw();
    }
    const anyLive = items.some((x) => x.g.status.state === 'in');
    const soon = items.some((x) => x.g.status.state === 'pre' && new Date(x.g.date) - Date.now() < 20 * 60_000);
    timer = setTimeout(tick, anyLive ? 30_000 : soon ? 60_000 : 5 * 60_000);
  };

  const offPrefs = onPrefsChange((kind) => { if (kind !== 'collapsed') draw(); });
  const onVisible = () => { if (!document.hidden) { clearTimeout(timer); tick(); } };
  document.addEventListener('visibilitychange', onVisible);
  tick();

  return () => {
    stopped = true;
    clearTimeout(timer);
    offPrefs();
    document.removeEventListener('visibilitychange', onVisible);
  };
}
