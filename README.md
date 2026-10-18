# Football Scoreboard

A personal, ad-free scoreboard for the NFL and FBS college football: live scores,
standings, logos and the AP Top 25. No articles, no news, no ads, no tracking.

Live site: https://jcolesrolemodel.github.io/football-scoreboard/

## What's in it

- **Live Now**: every live NFL and CFB game together at the top of the scores page,
  close late games first, refreshing every 30 seconds on its own.
- **Scores**: NFL / CFB toggle and a week picker covering the whole season
  (preseason, regular season, bowls and playoffs).
  - CFB games are grouped by conference and ordered by conference standings. A
    non-conference game shows under each FBS conference involved, FCS opponents are
    tagged "FCS", AP ranks sit before team names, and upsets are tagged.
  - NFL games are grouped by AFC/NFC and division, ordered by division standings. A
    game between two divisions shows under both.
  - Live games glow and refresh every 30 seconds in place, without reloading the page.
- **Standings**: CFB by conference, NFL by division.
- **AP Poll**: the Top 25 with movement versus the previous week, any past week of the
  season, and a chart of every ranked team's rank across the season. Hover or tap a
  line to follow one team.
- **Team pages**: tap any team for its schedule and results, record, standing and AP
  rank history.
- **My Teams**: star any team (on its page or by searching on the My Teams tab). Your
  teams are saved on your device, their games show first on the scoreboard, and their
  conferences and divisions come first in scores and standings.
- **Alerts**: tap the bell on any upcoming or live game to choose scoring updates,
  quarter updates (kickoff, end of each quarter, halftime, final) and changes of
  possession, or turn on alerts for every game your teams play. GitHub Pages has no
  server to push from, so alerts fire while the app is open or running in the
  background. On iPhone, add the app to your Home Screen first.
- **Collapsible sections**: every conference, division, AFC and NFC header has an arrow
  on the right to fold it away. The choice is remembered on your device.
- **Installable app**: add it to your Home Screen for a full-screen app with the
  football icon. It keeps working offline with the last scores it saw.

## How the data flows

```
ESPN public JSON ──► js/normalize.js ──► app models ──► views (js/views/*.js)
        │                    ▲
        │                    │ same adapter
        ▼                    │
GitHub Action ─► scripts/update-data.mjs ─► /data/*.json (committed to the repo)
```

- `js/normalize.js` is the only code that knows ESPN's JSON shapes. It turns raw
  responses into small, stable models (games, standings, polls). Both the browser and
  the archive script use it. Endpoint notes are in `docs/espn-endpoints.md`.
- `js/api.js` is what the views call. For the current week it fetches ESPN live from
  the browser. For past weeks and poll history it reads `/data`. If a live call fails
  it falls back to the latest `/data` snapshot and the page shows when that snapshot
  was updated.
- `.github/workflows/update-data.yml` runs `scripts/update-data.mjs`:
  - every 10 minutes Thursday through Monday from August to February,
  - once a day on Tuesday and Wednesday in season, and once a day from March to July,
  - and whenever you run it by hand.

  The first run backfills every completed week of the current season for both leagues.
  It commits only when a file actually changed.

### `/data` layout

| File | Contents |
| --- | --- |
| `data/index.json` | Season, current week, calendar and the list of archived weeks and polls per league |
| `data/{cfb,nfl}/{year}/week-{n}.json` | Every game of a regular-season week with scores and status (`pre-{n}` for NFL preseason, `post-{n}` for postseason) |
| `data/cfb/{year}/rankings/week-{n}.json` | AP Top 25 plus others receiving votes (`final.json` for the final poll) |
| `data/{cfb,nfl}/standings.json` | Current standings |

## Run it locally

No build step: the repo is the site.

```sh
npx serve .
```

Then open the URL it prints. To refresh the archive locally (needs Node 20+):

```sh
node scripts/update-data.mjs
```

## Run the data Action manually

1. Open the repo on GitHub and go to **Actions**.
2. Pick **Update data** in the sidebar.
3. Click **Run workflow**, keep the `main` branch, and confirm.

Or with the GitHub CLI: `gh workflow run update-data.yml`.

## Hosting

GitHub Pages serves the `main` branch root (Settings → Pages → Deploy from a branch →
`main` / root). The `.nojekyll` file makes Pages serve the files as they are.

## Privacy

The only outside requests are to ESPN (data and logos) and Google Fonts. There are no
analytics, cookies or ads. Your league, favorite teams, alert choices and folded sections
stay in your browser's local storage and never leave your device.
