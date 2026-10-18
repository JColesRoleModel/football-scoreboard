// Preferences kept on this device in localStorage: favorite teams, collapsed sections,
// and game alert subscriptions. Every read and write tolerates storage being unavailable.

const KEY = 'fs-prefs-v1';
const listeners = new Set();

function load() {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      favorites: Array.isArray(p.favorites) ? p.favorites : [],
      collapsed: p.collapsed && typeof p.collapsed === 'object' ? p.collapsed : {},
      alerts: p.alerts && typeof p.alerts === 'object' ? p.alerts : {},
      teamAlerts: { enabled: false, score: true, quarter: true, poss: false, ...(p.teamAlerts || {}) },
    };
  } catch {
    return { favorites: [], collapsed: {}, alerts: {}, teamAlerts: { enabled: false, score: true, quarter: true, poss: false } };
  }
}

let prefs = load();

// `kind` says what changed ('favorites', 'collapsed', 'alerts') so listeners can skip the rest.
function save(kind) {
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode: keep in memory */ }
  for (const fn of listeners) fn(kind, prefs);
}

// Another tab changed the prefs.
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  prefs = load();
  for (const fn of listeners) fn('all', prefs);
});

export const onPrefsChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// ---- Favorites ----
const favKey = (league, id) => `${league}:${id}`;
export const favorites = () => prefs.favorites;
export const isFavorite = (league, id) => prefs.favorites.some((f) => favKey(f.league, f.id) === favKey(league, id));
export const favoriteIds = (league) => new Set(prefs.favorites.filter((f) => f.league === league).map((f) => f.id));

export function toggleFavorite(league, team) {
  if (isFavorite(league, team.id)) {
    prefs.favorites = prefs.favorites.filter((f) => favKey(f.league, f.id) !== favKey(league, team.id));
  } else {
    prefs.favorites = [...prefs.favorites, {
      league, id: String(team.id), name: team.name || team.display || '', display: team.display || team.name || '',
      short: team.short || '', abbr: team.abbr || '', logo: team.logo || '',
    }];
  }
  save('favorites');
  return isFavorite(league, team.id);
}

// ---- Collapsed sections ----
export const isCollapsed = (key) => !!prefs.collapsed[key];
export function setCollapsed(key, on) {
  if (on) prefs.collapsed[key] = 1; else delete prefs.collapsed[key];
  save('collapsed');
}

// ---- Game alerts ----
// alerts: { "league:gameId": { league, gameId, label, date, types: { score, quarter, poss } } }
export const ALERT_TYPES = [
  { key: 'score', label: 'Scoring updates', hint: 'Touchdowns, field goals and safeties' },
  { key: 'quarter', label: 'Quarter updates', hint: 'Kickoff, end of each quarter, halftime and final' },
  { key: 'poss', label: 'Change of possession', hint: 'Every time the ball changes hands' },
];

export const gameAlerts = () => prefs.alerts;
export const gameAlert = (league, gameId) => prefs.alerts[`${league}:${gameId}`] || null;

export function setGameAlert(league, game, types) {
  const key = `${league}:${game.id}`;
  if (!types || !Object.values(types).some(Boolean)) delete prefs.alerts[key];
  else prefs.alerts[key] = { league, gameId: game.id, label: game.name, date: game.date, types };
  save('alerts');
}

// Drop subscriptions for games that ended more than a day ago.
export function pruneAlerts() {
  const cutoff = Date.now() - 2 * 86_400_000;
  let changed = false;
  for (const [k, a] of Object.entries(prefs.alerts)) {
    if (a.date && new Date(a.date).getTime() < cutoff) { delete prefs.alerts[k]; changed = true; }
  }
  if (changed) save('alerts');
}

export const teamAlerts = () => prefs.teamAlerts;
export function setTeamAlerts(patch) {
  prefs.teamAlerts = { ...prefs.teamAlerts, ...patch };
  save('alerts');
}

// Alert types that apply to a game: its own subscription, else "my teams" alerts if a favorite plays.
export function alertTypesFor(league, game) {
  const own = gameAlert(league, game.id);
  if (own) return own.types;
  const ta = prefs.teamAlerts;
  if (ta.enabled && (isFavorite(league, game.home.id) || isFavorite(league, game.away.id))) {
    return { score: ta.score, quarter: ta.quarter, poss: ta.poss };
  }
  return null;
}
