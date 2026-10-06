# Changelog

Every release of TilePier, newest first. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [1.0.1] - 2026-10-07

### Fixed

- **The weather tile links to Open-Meteo.** Open-Meteo's licence requires a
  link beside every display of its data. The detail and the licences page had
  one, but the tile, which shows the same forecast, did not. It now carries
  "Open-Meteo.com" under the reading, sized to fit the smallest tile.

## [1.0.0] - 2026-10-06

The first release. TilePier has run at [tilepier.win](https://tilepier.win)
since 2026-08-19: every merge to `main` deployed, and the roadmap's weekly
milestones (M1 to M7, `docs/internal/23-ROADMAP.md`) were deployments rather
than tags. No 0.x version was ever cut.

### Added

- **Fifteen widgets.**
  - Clock, with world clocks.
  - Timer: countdown and pomodoro, with a focus log.
  - Calculator: exact decimals and a unit converter.
  - Notes in Markdown.
  - Todo lists with due dates.
  - Calendar: the month, with the Vietnamese lunar calendar.
  - Toolbox: QR codes, passwords and colours.
  - Currency: conversion and a history chart.
  - Weather: the next hours as a chart, and the week.
  - Quote of the day.
  - Feeds: RSS, Atom and RDF, with OPML import and export.
  - Map: your places, with search.
  - Markets: coins and stocks, with candle charts.
  - Music: your own files, with playlists and resume.
  - Video: with subtitles and picture-in-picture.
- **The deck.**
  - A grid you arrange and resize, from one column on a phone to twelve on a
    wide screen.
  - A drawer to add tiles.
  - A detail view for every widget, each with its own address (`/w/<id>`).
  - Keyboard shortcuts.
- **Local-first storage.**
  - The layout and settings in localStorage, everything else in IndexedDB:
    what you arrange and write is stored on your device and nowhere else.
  - A backup to export, a dry run of an import, and merge or replace.
- **Offline.**
  - An installable app with its shell precached.
  - What you use is kept, and the details of the widgets on your deck are
    fetched while it is idle.
  - Tiles say how old their data is instead of going blank.
- **Vietnamese and English** throughout, switchable in Settings.
- **Settings.**
  - Theme (dark, light or the system's), accent colour, motion, and scrollbars
    shown or hidden.
  - Language, backup, and diagnostics.
  - A bug report you review before anything is sent.
- **The `/api/*` proxy**, on the same Worker.
  - Upstream keys kept on the server.
  - KV caching that serves stale data when an upstream fails.
  - Rate limits, circuit breakers, and a daily budget for Twelve Data.

### Security

- **A Content-Security-Policy with exact source lists**, pinned by tests. The
  browser reaches three hosts besides the app's own:
  - map tiles;
  - the analytics beacon's report;
  - the bot check's frame.
- **Security headers on every page**, from one list held to `_headers`, to the
  Worker and to production.
- **A Turnstile bot check** in front of `/api/*`.
- **A feed fetcher that refuses private, loopback and its own addresses**, on
  every redirect hop.
- **Markdown and feed summaries sanitised by DOMPurify**, which are the only
  HTML rendered as HTML.
- **Supply-chain checks:**
  - a CI audit of every dependency, at release with no known advisory
    (DOMPurify 3.4.16 among the last taken);
  - Dependabot;
  - CodeQL.
- **A way to report a vulnerability:** `SECURITY.md`, and
  `/.well-known/security.txt`.

### Accessibility

- **WCAG 2.2 AA contrast in both themes, for any accent colour.** A test paints
  the design tokens and measures them.
- **An axe sweep of every surface in CI**, with each detail checked in both
  themes nightly.
- **Controls sized for touch:** 40 px outside a tile, 24 px inside one.
- **Reflow to 400 % zoom.**
- **Chart summary lines** that a screen reader can read.

### Known limitations

- **Markets.**
  - Stocks need the server's Finnhub and Twelve Data keys.
  - Twelve Data's free tier allows 800 credits a day. When they run out,
    charts fall back to data up to seven days old.
- **Music.** A folder (File System Access) works in Chromium browsers. Elsewhere,
  add files.
- **Air quality** is fetched but not shown; the gauge was cut in Week 4.
- **Adding a widget offline.** A widget never loaded on a device cannot be added
  while offline, and it says so.
- **`/legal/licenses`** is not kept for offline reading.
- **Two tabs at once.** The last write wins, and the contents of the database
  refresh on reload.

[1.0.1]: https://github.com/poli0981/tilepier/releases/tag/v1.0.1
[1.0.0]: https://github.com/poli0981/tilepier/releases/tag/v1.0.0
