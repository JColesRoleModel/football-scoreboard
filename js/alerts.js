// Game alerts: the bell sheet on game cards, and a watcher that polls the current week
// and fires notifications for scoring plays, quarter changes and changes of possession.
//
// GitHub Pages has no server to push from, so alerts fire while the app is open or
// running in the background. On iPhone, notifications need the app added to the Home Screen.

import { getScoreboard } from './api.js';
import { LEAGUES } from './normalize.js';
import {
  ALERT_TYPES, gameAlert, setGameAlert, alertTypesFor, gameAlerts, teamAlerts, favorites, pruneAlerts, onPrefsChange,
} from './prefs.js';
import { esc, toast } from './ui.js';

const known = new Map(); // "league:id" -> game, from whatever the views last rendered
export function registerGames(league, games) {
  for (const g of games) known.set(`${league}:${g.id}`, g);
}

// ---- Permission ----
export const notifySupported = () => 'Notification' in window;
export const notifyPermission = () => (notifySupported() ? Notification.permission : 'unsupported');
export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export async function ensurePermission() {
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
  }
  return Notification.permission;
}

async function notify(title, body, tag, url) {
  toast(`${title} · ${body}`, 6000);
  if (notifyPermission() !== 'granted') return;
  const opts = { body, tag, renotify: true, icon: 'assets/icon-192.png', badge: 'assets/icon-192.png', data: { url } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) return reg.showNotification(title, opts);
    new Notification(title, opts); // eslint-disable-line no-new
  } catch { /* the toast already showed it */ }
}

// ---- Bell sheet ----
let dialog;
function sheet() {
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.className = 'sheet glass';
  document.body.appendChild(dialog);
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  return dialog;
}

export async function openAlertSheet(league, game) {
  const d = sheet();
  const cur = gameAlert(league, game.id)?.types || alertTypesFor(league, game) || { score: true, quarter: true, poss: false };
  const perm = notifyPermission();
  const iosHint = isIOS() && !isStandalone()
    ? '<p class="sheet-hint">On iPhone, add this site to your Home Screen first (Share, then Add to Home Screen) so alerts can reach you.</p>' : '';
  const blocked = perm === 'denied'
    ? '<p class="sheet-hint warn">Notifications are blocked for this site in your browser settings, so alerts will only show inside the app.</p>' : '';
  d.innerHTML = `<form method="dialog" class="sheet-form">
    <h3>Alerts for ${esc(game.away.short || game.away.name)} at ${esc(game.home.short || game.home.name)}</h3>
    ${ALERT_TYPES.map((t) => `<label class="check"><input type="checkbox" name="${t.key}" ${cur[t.key] ? 'checked' : ''}><span><b>${esc(t.label)}</b><small>${esc(t.hint)}</small></span></label>`).join('')}
    ${iosHint}${blocked}
    <p class="sheet-hint">Alerts arrive while the app is open or running in the background.</p>
    <div class="sheet-actions">
      ${gameAlert(league, game.id) ? '<button value="off" class="btn ghost">Turn off</button>' : ''}
      <button value="cancel" class="btn ghost">Cancel</button>
      <button value="save" class="btn primary">Save</button>
    </div>
  </form>`;
  d.showModal();
  const form = d.querySelector('form');
  form.addEventListener('submit', async (e) => {
    const action = e.submitter?.value;
    if (action === 'off') { setGameAlert(league, game, null); toast('Alerts off for this game'); return; }
    if (action !== 'save') return;
    const types = Object.fromEntries(ALERT_TYPES.map((t) => [t.key, form.elements[t.key].checked]));
    setGameAlert(league, game, types);
    if (Object.values(types).some(Boolean)) {
      const p = await ensurePermission();
      toast(p === 'granted' ? 'Alerts on for this game' : 'Alerts on. They will show inside the app.');
      watch();
    }
  }, { once: true });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.bell[data-game]');
  if (!b) return;
  e.preventDefault();
  const g = known.get(`${b.dataset.league}:${b.dataset.game}`);
  if (g) openAlertSheet(b.dataset.league, g);
});

// ---- Watcher ----
const SNAP_KEY = 'fs-alert-snap-v1';
let snaps = {};
try { snaps = JSON.parse(sessionStorage.getItem(SNAP_KEY) || '{}'); } catch { /* fresh */ }
const saveSnaps = () => { try { sessionStorage.setItem(SNAP_KEY, JSON.stringify(snaps)); } catch { /* ignore */ } };

const qName = (p) => (p > 4 ? (p === 5 ? 'OT' : `${p - 4}OT`) : `Q${p}`);
const scoreLine = (g) => `${g.away.abbr} ${g.away.score ?? 0}, ${g.home.abbr} ${g.home.score ?? 0}`;
const teamName = (t) => t.short || t.name;

function scoreKind(pts) {
  if (pts >= 6) return 'Touchdown';
  if (pts === 3) return 'Field goal';
  if (pts === 2) return 'Two points';
  if (pts === 1) return 'Extra point';
  return 'Score';
}

function diff(league, g, types) {
  const key = `${league}:${g.id}`;
  const prev = snaps[key];
  const now = {
    state: g.status.state, period: g.status.period, name: g.status.name,
    hs: g.home.score ?? 0, as: g.away.score ?? 0, poss: g.situation?.poss || '',
  };
  snaps[key] = now;
  if (!prev) return;
  const url = `#/scores/${league}`;
  const tagBase = `${league}-${g.id}`;

  if (types.score) {
    for (const [side, before, after] of [['home', prev.hs, now.hs], ['away', prev.as, now.as]]) {
      if (after > before) {
        notify(`${scoreKind(after - before)}, ${teamName(g[side])}`, `${scoreLine(g)} · ${statusLine(g)}`, `${tagBase}-score`, url);
      }
    }
  }
  if (types.quarter) {
    if (prev.state === 'pre' && now.state === 'in') notify(`Kickoff: ${g.name}`, scoreLine(g), `${tagBase}-q`, url);
    else if (now.state === 'post' && prev.state !== 'post') notify(`Final${g.status.ot ? '/OT' : ''}: ${g.name}`, scoreLine(g), `${tagBase}-q`, url);
    else if (now.state === 'in') {
      if (/HALFTIME/.test(now.name) && !/HALFTIME/.test(prev.name)) notify(`Halftime: ${g.name}`, scoreLine(g), `${tagBase}-q`, url);
      else if (/END_PERIOD/.test(now.name) && !/END_PERIOD/.test(prev.name)) notify(`End of ${qName(now.period)}: ${g.name}`, scoreLine(g), `${tagBase}-q`, url);
      else if (now.period > prev.period && !/END_PERIOD|HALFTIME/.test(prev.name)) {
        // Missed the end-of-quarter state between polls: report the quarter that just ended.
        notify(`End of ${qName(prev.period)}: ${g.name}`, scoreLine(g), `${tagBase}-q`, url);
      }
    }
  }
  if (types.poss && now.state === 'in' && now.poss && prev.poss && now.poss !== prev.poss) {
    const t = g.home.id === now.poss ? g.home : g.away;
    notify(`${teamName(t)} ball`, `${g.situation?.down ? `${g.situation.down} · ` : ''}${scoreLine(g)} · ${statusLine(g)}`, `${tagBase}-poss`, url);
  }
}

function statusLine(g) {
  const s = g.status;
  if (/HALFTIME/.test(s.name)) return 'Halftime';
  return `${qName(s.period)} ${s.clock}`.trim();
}

function leaguesToWatch() {
  const set = new Set(Object.values(gameAlerts()).map((a) => a.league));
  if (teamAlerts().enabled) for (const f of favorites()) set.add(f.league);
  return [...set].filter((l) => LEAGUES[l]);
}

let timer = 0;
async function tick() {
  clearTimeout(timer);
  const leagues = leaguesToWatch();
  if (!leagues.length) return;
  let delay = 5 * 60_000;
  for (const league of leagues) {
    try {
      const { data } = await getScoreboard(league);
      registerGames(league, data.games);
      for (const g of data.games) {
        const types = alertTypesFor(league, g);
        if (!types) continue;
        diff(league, g, types);
        if (g.status.state === 'in') delay = 30_000;
        else if (g.status.state === 'pre' && new Date(g.date) - Date.now() < 20 * 60_000) delay = Math.min(delay, 60_000);
      }
    } catch { /* try again next tick */ }
  }
  saveSnaps();
  timer = setTimeout(tick, delay);
}

export function watch() {
  pruneAlerts();
  tick();
}

onPrefsChange((kind) => { if (kind === 'alerts' || kind === 'favorites' || kind === 'all') watch(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) watch(); });
