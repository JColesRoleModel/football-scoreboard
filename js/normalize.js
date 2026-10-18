// Pure functions that turn raw ESPN JSON into the app's own models.
// Shared by the browser (js/api.js) and the archive script (scripts/update-data.mjs),
// so this is the only file that knows ESPN's response shapes.

export const LEAGUES = {
  cfb: { sport: 'college-football', name: 'College Football', short: 'CFB' },
  nfl: { sport: 'nfl', name: 'NFL', short: 'NFL' },
};

const num = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'object') v = v.value ?? v.displayValue;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function teamLogo(t, league) {
  if (!t) return '';
  if (typeof t.logo === 'string' && t.logo) return t.logo;
  const logos = t.logos || [];
  const pick = logos.find((l) => (l.rel || []).includes('default')) || logos[0];
  if (pick?.href) return pick.href;
  if (t.id) return `https://a.espncdn.com/i/teamlogos/${league === 'nfl' ? 'nfl' : 'ncaa'}/500/${t.id}.png`;
  return '';
}

// Display order for CFB conferences: power conferences first, independents last.
const CFB_CONF_ORDER = ['8', '5', '4', '1', '9', '151', '17', '37', '15', '12'];
export function cfbConfRank(id) {
  if (id === '18') return 1e3;
  if (id === 'other') return 1e4;
  const i = CFB_CONF_ORDER.indexOf(id);
  return i >= 0 ? i : 100;
}

export function confLogo(league, id) {
  if (league === 'nfl') {
    const c = String(id).toLowerCase();
    if (c === 'afc' || c === '8') return 'https://a.espncdn.com/i/teamlogos/nfl/500/afc.png';
    if (c === 'nfc' || c === '7') return 'https://a.espncdn.com/i/teamlogos/nfl/500/nfc.png';
    return 'https://a.espncdn.com/i/teamlogos/leagues/500/nfl.png';
  }
  return id ? `https://a.espncdn.com/i/teamlogos/ncaa_conf/500/${id}.png` : '';
}

export function normalizeTeam(t, league) {
  if (!t) return null;
  return {
    id: String(t.id ?? ''),
    abbr: t.abbreviation || '',
    name: t.location || t.shortDisplayName || t.displayName || '',
    nickname: t.name || t.nickname || '',
    display: t.displayName || [t.location, t.name].filter(Boolean).join(' '),
    short: t.shortDisplayName || t.location || '',
    color: t.color ? `#${t.color}` : '',
    logo: teamLogo(t, league),
  };
}

function recordOf(c, type) {
  const recs = c.records || c.record || [];
  if (!Array.isArray(recs)) return '';
  const r = recs.find((x) => x.type === type || x.name === type);
  return r?.summary || r?.displayValue || '';
}

function statusOf(s) {
  const t = s?.type || {};
  return {
    state: t.state || 'pre', // pre | in | post
    name: t.name || '',
    completed: !!t.completed,
    detail: t.detail || t.description || '',
    shortDetail: t.shortDetail || t.detail || '',
    period: s?.period ?? 0,
    clock: s?.displayClock || '',
    postponed: /POSTPONED|CANCELED|CANCELLED|SUSPENDED|DELAYED/.test(t.name || ''),
  };
}

function tvOf(comp) {
  const names = [];
  for (const b of comp.broadcasts || []) for (const n of b.names || []) names.push(n);
  if (!names.length && typeof comp.broadcast === 'string' && comp.broadcast) names.push(comp.broadcast);
  if (!names.length) for (const g of comp.geoBroadcasts || []) if (g.media?.shortName) names.push(g.media.shortName);
  return [...new Set(names)].join(' / ');
}

export function normalizeEvent(ev, league) {
  const comp = ev.competitions?.[0];
  if (!comp) return null;
  const status = statusOf(comp.status || ev.status);
  const sides = {};
  for (const c of comp.competitors || []) {
    const team = normalizeTeam(c.team, league);
    const rank = num(c.curatedRank?.current ?? c.rank);
    sides[c.homeAway === 'home' ? 'home' : 'away'] = {
      ...team,
      score: status.state === 'pre' ? null : num(c.score),
      winner: c.winner === true,
      rank: rank && rank <= 25 ? rank : null,
      record: recordOf(c, 'total') || recordOf(c, 'overall'),
      confRecord: recordOf(c, 'vsconf'),
      confId: c.team?.conferenceId ? String(c.team.conferenceId) : '',
    };
  }
  const { home, away } = sides;
  if (!home || !away) return null;
  // ESPN only sets `winner` once a game is decided; fill it from the score otherwise.
  if (status.state === 'post' && !home.winner && !away.winner && home.score != null && away.score != null) {
    if (home.score > away.score) home.winner = true;
    else if (away.score > home.score) away.winner = true;
  }
  const ot = status.state === 'post' && status.period > 4;
  return {
    id: String(ev.id),
    date: comp.date || ev.date,
    name: ev.shortName || ev.name || '',
    status: { ...status, ot },
    neutral: !!comp.neutralSite,
    conferenceGame: !!comp.conferenceCompetition,
    note: (comp.notes || []).map((n) => n.headline).filter(Boolean)[0] || '',
    tv: tvOf(comp),
    venue: comp.venue?.fullName || '',
    seasonType: num(ev.season?.type) ?? null,
    week: num(ev.week?.number) ?? null,
    home,
    away,
  };
}

export function normalizeCalendar(raw) {
  const lg = raw.leagues?.[0] || {};
  const types = (lg.calendar || [])
    .filter((t) => Array.isArray(t.entries) && t.entries.length)
    .map((t) => ({
      type: Number(t.value),
      label: t.label,
      weeks: t.entries.map((e) => ({
        value: Number(e.value),
        label: e.label,
        detail: e.detail || '',
        start: e.startDate,
        end: e.endDate,
      })),
    }));
  return {
    season: num(lg.season?.year) ?? num(raw.season?.year),
    types,
    current: { type: num(raw.season?.type) ?? 2, week: num(raw.week?.number) ?? 1 },
    logo: teamLogo(lg, null),
  };
}

export function normalizeScoreboard(raw, league) {
  const games = (raw.events || []).map((e) => normalizeEvent(e, league)).filter(Boolean);
  const byes = (raw.week?.teamsOnBye || []).map((t) => normalizeTeam(t, league));
  return {
    league,
    season: num(raw.season?.year),
    seasonType: num(raw.season?.type),
    week: num(raw.week?.number),
    calendar: normalizeCalendar(raw),
    byes,
    games,
  };
}

// Standings stats: match on `type` because CFB and NFL use different `name` casing.
function stat(entry, type) {
  const s = (entry.stats || []).find((x) => (x.type || '').toLowerCase() === type || (x.name || '').toLowerCase() === type);
  if (!s) return null;
  return s.summary ?? s.displayValue ?? s.value;
}
const statNum = (e, t) => num(stat(e, t));

function standingRow(entry, league, idx) {
  const t = normalizeTeam(entry.team, league);
  const wins = statNum(entry, 'wins') ?? 0;
  const losses = statNum(entry, 'losses') ?? 0;
  const ties = statNum(entry, 'ties') ?? 0;
  const overall = stat(entry, 'total') || stat(entry, 'overall') || `${wins}-${losses}${ties ? `-${ties}` : ''}`;
  return {
    ...t,
    order: idx,
    overall: String(overall),
    conf: String(stat(entry, 'vsconf') || ''),
    div: String(stat(entry, 'vsdiv') || stat(entry, 'vsdivision') || stat(entry, 'divisionrecord') || ''),
    wins,
    losses,
    ties,
    pct: statNum(entry, 'winpercent') ?? (wins + losses + ties ? (wins + ties / 2) / (wins + losses + ties) : 0),
    pf: statNum(entry, 'pointsfor'),
    pa: statNum(entry, 'pointsagainst'),
    streak: String(stat(entry, 'streak') || ''),
    seed: statNum(entry, 'playoffseed'),
  };
}

function flattenChildren(node) {
  if (node.standings?.entries) return [node];
  return (node.children || []).flatMap(flattenChildren);
}

// CFB: groups are conferences. NFL: groups are divisions (needs the /groups payload).
export function normalizeStandings(raw, league, nflGroups) {
  const season = num(raw.children?.[0]?.standings?.season) ?? num(raw.season);
  if (league === 'cfb') {
    const groups = flattenChildren(raw).map((c) => ({
      id: String(c.id),
      name: c.name,
      abbr: c.abbreviation || c.shortName || c.name,
      logo: confLogo('cfb', c.id),
      teams: c.standings.entries.map((e, i) => standingRow(e, league, i)),
    }));
    return { league, season, groups };
  }
  const divOf = {};
  for (const conf of nflGroups?.groups || []) {
    const confAbbr = conf.abbreviation || (/american/i.test(conf.name) ? 'AFC' : 'NFC');
    for (const d of conf.children || []) {
      for (const t of d.teams || []) divOf[String(t.id)] = { conf: confAbbr, name: d.name, abbr: d.abbreviation };
    }
  }
  const groups = [];
  for (const conf of raw.children || []) {
    const confAbbr = conf.abbreviation || conf.shortName;
    const rows = (conf.standings?.entries || []).map((e, i) => standingRow(e, league, i));
    const divs = new Map();
    for (const r of rows) {
      const d = divOf[r.id] || { conf: confAbbr, name: `${confAbbr}`, abbr: confAbbr };
      if (!divs.has(d.name)) divs.set(d.name, { id: d.name.replace(/\s+/g, '-').toLowerCase(), name: d.name, abbr: d.name, conf: confAbbr, logo: confLogo('nfl', confAbbr), teams: [] });
      divs.get(d.name).teams.push(r);
    }
    for (const d of divs.values()) {
      // Division order: best record first, ESPN's conference order breaks ties.
      d.teams.sort((a, b) => b.pct - a.pct || a.order - b.order);
      d.teams.forEach((t, i) => (t.order = i));
      groups.push(d);
    }
  }
  groups.sort((a, b) => a.conf.localeCompare(b.conf) || ['East', 'North', 'South', 'West'].findIndex((x) => a.name.endsWith(x)) - ['East', 'North', 'South', 'West'].findIndex((x) => b.name.endsWith(x)));
  return { league, season, groups };
}

function rankRow(r, league) {
  return {
    rank: num(r.current),
    prev: num(r.previous) || null,
    points: num(r.points),
    fpv: num(r.firstPlaceVotes) || 0,
    trend: r.trend || '',
    record: r.recordSummary || r.record?.summary || '',
    team: normalizeTeam(r.team, league),
  };
}

export function normalizeRanking(poll, league = 'cfb') {
  if (!poll) return null;
  return {
    name: poll.name || 'AP Top 25',
    season: num(poll.season?.year),
    seasonType: num(poll.season?.type?.type ?? poll.season?.type) ?? 2,
    week: num(poll.occurrence?.number),
    label: poll.occurrence?.displayValue || poll.headline || '',
    date: poll.date || poll.ranks?.[0]?.date || '',
    ranks: (poll.ranks || []).map((r) => rankRow(r, league)).filter((r) => r.rank && r.rank <= 25),
    others: (poll.others || []).map((r) => rankRow(r, league)),
    droppedOut: (poll.droppedOut || []).map((r) => rankRow(r, league)),
  };
}

export function pickAP(raw) {
  const list = raw.rankings || [];
  return list.find((r) => r.type === 'ap' || /AP/.test(r.shortName || r.name || '')) || null;
}

export function normalizeSchedule(raw, league) {
  return {
    team: { ...normalizeTeam(raw.team, league), record: raw.team?.recordSummary || '', standing: raw.team?.standingSummary || '' },
    games: (raw.events || []).map((e) => normalizeEvent(e, league)).filter(Boolean),
  };
}
