# ESPN endpoint notes

ESPN's site and core APIs are public but undocumented. These notes record the
response shapes checked on 2026-10-18. Only `js/normalize.js` knows about these
shapes; everything else in the app uses the normalized models it returns.

## Scoreboards

`https://site.api.espn.com/apis/site/v2/sports/football/{college-football|nfl}/scoreboard`

Query: `week`, `seasontype` (1 pre, 2 regular, 3 post), `dates={year}` for a
past season, and for CFB `groups=80` (all FBS) and `limit=300`.

- Top level: `leagues`, `season {type, year}`, `week {number, teamsOnBye?}`, `events`.
- `leagues[0].calendar`: array of season types `{label, value, startDate, endDate, entries}`;
  each entry is `{label, alternateLabel, detail, value, startDate, endDate}`.
  CFB: Regular Season weeks 1-15, Postseason `Bowls` (value 1) and `CFP` (value 999).
  NFL: Preseason (HOF + weeks 1-3), Regular Season weeks 1-18, Postseason 4 rounds.
  "Off Season" (value 4) has no entries.
- `leagues[0].logos[]`: league logos.
- `events[].competitions[0]`: `date`, `neutralSite`, `conferenceCompetition`,
  `notes[] {headline}`, `status`, `broadcasts[] {market, names[]}`, `broadcast` (string),
  `geoBroadcasts[]`, `venue`, `competitors[]`.
- `status`: `{clock, displayClock, period, type {name, state: pre|in|post, completed, detail, shortDetail}}`.
  Postponed / canceled use `STATUS_POSTPONED` / `STATUS_CANCELED`.
- `competitors[]`: `homeAway`, `score` (string; schedule endpoints use `{value, displayValue}`),
  `winner` (only once decided), `curatedRank {current}` (99 = unranked),
  `records[] {name, type, summary}` (`total` overall, `vsconf`, `home`, `road`),
  `team {id, abbreviation, location, displayName, shortDisplayName, color, logo, conferenceId}`.
  `conferenceId` is CFB only; it matches the conference ids in standings.

## Standings

`https://site.api.espn.com/apis/v2/sports/football/college-football/standings?group=80`
`https://site.api.espn.com/apis/v2/sports/football/nfl/standings`

- Top level `{id, name, children[]}`. CFB children are conferences
  (`{id, name, abbreviation, standings {entries}}`); NFL children are AFC (8) and NFC (7)
  with a flat entry list and no division info.
- Entry: `{team {id, abbreviation, displayName, location, logos[]}, stats[]}`.
  Stats are `{name, type, value, displayValue}`; record summaries
  (`type` `total`, `vsconf`, `vsdivision`, `home`, `road`) carry `summary` instead of `value`.
  CFB names are lower case (`wins`, `playoffseed`, `vsconf`...), NFL names camel case
  (`wins`, `playoffSeed`, `divisionRecord`...). The adapter matches on `type`.
- Entries come in ESPN's standings order (tiebreakers applied), which the app keeps.

## Groups (NFL divisions)

`https://site.api.espn.com/apis/site/v2/sports/football/nfl/groups` returns
`groups[] {name, abbreviation, children[] {name, abbreviation, teams[]}}`. The adapter
uses it to put NFL teams into divisions. (The CFB `/groups` endpoint only lists
Division II/III, so CFB conferences come from standings.)

## Rankings

- Current: `https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings`
  `rankings[] {name, shortName, type ('ap'), occurrence {number, displayValue}, season, ranks[], others[]?, droppedOut[]?}`;
  rank item `{current, previous, points, firstPlaceVotes, trend, recordSummary, team {id, abbreviation, location, nickname, logos[]}}`.
- By week: `https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{year}/types/{type}/weeks/{n}/rankings`
  is a page of `$ref` links (`{count, items[] {$ref}}`), one per poll; AP is id 1. Each poll's
  ranks reference teams by `$ref`, so the archive script resolves them. Weeks without a poll
  return `count: 0`.

## Team schedule

`https://site.api.espn.com/apis/site/v2/sports/football/{league}/teams/{id}/schedule`
`{team {id, abbreviation, displayName, logo, recordSummary, standingSummary}, events[]}`.

## Logos

Team objects carry `logo` or `logos[].href` on `a.espncdn.com`. Conference logos
follow `https://a.espncdn.com/i/teamlogos/ncaa_conf/500/{conferenceId}.png`, NFL
conference logos `https://a.espncdn.com/i/teamlogos/nfl/500/{afc|nfc}.png`. Every logo
in the UI falls back to an abbreviation badge if the image fails.

## CORS

The build container could not run curl against ESPN, so browser CORS was not
confirmed from a terminal. The site fetches live data client-side first and
falls back to the `/data` archive (written by the GitHub Action, which runs
server-side and is unaffected by CORS) whenever a live request fails.
