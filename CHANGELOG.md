# Changelog

Every release of TilePier, newest first. The format follows
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-11-09

### Added

- **Tiles can be arranged without dragging.** In edit mode every tile has an
  Arrange button. Its panel moves the tile with buttons or the arrow keys,
  resizes it with Shift and the arrows, and says where the tile is after each
  step. Until now a tile moved only by dragging its header with a mouse.
- **The single-key shortcuts can be turned off**, in Settings → Keyboard. `e`
  and `?` are single characters, which speech input and screen readers can set
  off by accident. `Esc` keeps working, and a button in the same place opens
  the list of shortcuts.
- **A "Skip to main content" link** is the first stop on every page of the app.
- **Windows contrast themes** keep pressed and selected choices, focus rings,
  colour swatches and status dots visible.
- **An accessibility statement**, `ACCESSIBILITY.md`, with what TilePier does,
  how it is tested, what it does not do yet, and a form for reporting a barrier.
  The About page links both.

### Changed

- **Every tile is a named region, and its buttons say which tile they belong
  to**: "Open Weather detail" rather than fifteen buttons called "open detail".
  Two tiles of the same widget are numbered. The drawer's Add buttons name their
  widget too.
- **Adding and removing a tile is announced**, and removing one moves focus to
  the next tile instead of losing it.
- **A notice stays while the pointer or focus is on it**, and screen readers
  announce it reliably.
- **Sliders say their value in words**: the meeting planner a time, volume a
  percentage, the seek bar its position out of the length.
- **The language of the parts**: a quote shown in its other language, and the
  names of the two languages, carry their own language for screen readers.
- The toolchain's patch and minor releases: SvelteKit 3.1.1, adapter-cloudflare
  8.0.2, Svelte 5.57.3, wrangler 4.156, ESLint 10.14, knip 6.44, Paraglide
  2.29.3, marked 18.1.2 and music-metadata 12.3.2. The music scanner's worker
  grew to 82.6 KB gzipped, and its budget is now 88 KB.

### Fixed

- **To-do: "make the first one" makes the first list.** The tile's empty state
  offered it since 1.0.0 and the button did nothing.
- **To-do: a list can be renamed from the keyboard**, with F2. A double-click was
  the only way.
- **`Esc` in a rename field cancels the rename and nothing else.** In the to-do
  and map details it closed the whole panel too, and the to-do detail kept the
  name `Esc` was meant to discard.
- **`Esc` in the add drawer's search box closes the drawer.** It did nothing.
- **Eight text fields show a focus ring**: the drawer's search, the notes and
  to-do tiles and details, and the clock's zone search. Only the caret showed
  where focus was.
- **The shortcuts list, the add drawer and the bug report keep focus inside**
  while open and give it back when they close; the bug report now closes on
  `Esc`.
- **Reduce motion: on** now stops the loading shimmer and the map's flights as
  well, not only when the system asks for reduced motion.
- **The calendar's event dot is read out** with its count.

### Accessibility

- Checked by hand on 1.2.0 before this release: the keyboard alone with the
  mouse disconnected, Narrator on Edge, Firefox and Brave, and VoiceOver or
  TalkBack, with no failures. The new Arrange panel and announcements wait for
  the same check on 1.3.0.
- `svelte-check` now fails on any warning, Svelte's accessibility checks
  included.

### Security

- **SvelteKit 3.1.1** hardens two paths: route resolution on the server no
  longer loads code from another origin for a path that starts with `//`, and
  remote form submissions are parsed in linear time.

## [1.2.0] - 2026-10-27

### Changed

- **The Worker's rate limit runs on Cloudflare's Rate Limiting binding.** It
  is the same 30 requests per 10 seconds per reader on `/api/*`, counted
  inside Cloudflare instead of in the app's storage, so a request no longer
  costs a storage write. It is checked once, before the cache and the bot
  check, so every API route and every repeated answer counts toward it.
- **Pages the Worker renders are limited too**, such as a page that does not
  exist: 30 per 10 seconds per reader, on an allowance of their own, answered
  with `429` and `retry-after`. Pages and files served as they were built are
  not affected.
- **An IPv6 reader counts as its /64**, so moving between addresses in one
  household's range no longer buys a fresh limit.
- **The zone's rate-limiting rule is now one a free zone can set**: `/api/*`,
  60 requests per 10 seconds per IP, blocked for 10 seconds.
  `docs/self-hosting.md` has the steps.

### Fixed

- **A block by the zone's rule reads as "too many requests".** Cloudflare
  answers it with its own page rather than the app's JSON, and the app took
  that for a broken answer: tiles kept their own retry schedule, the feed
  reader's queue did not pause, and the one notice did not appear.

## [1.1.0] - 2026-10-26

### Changed

- **Node 26 and TypeScript 7.** Building TilePier needs Node 26 (named in
  `.node-version`). The code is checked by TypeScript 7's native compiler,
  against ES2025, in under a second; the editor and lint tools read TypeScript
  6.0 until they support 7.
- The rest of the toolchain at its newest releases: Svelte 5.57, ESLint 10.13,
  Playwright 1.64, Paraglide 2.29, and wrangler 4.152 with the Workers runtime
  of 2026-10-19.
- The tests run on Vitest 5 and MSW 3, and music files are read with
  music-metadata 12.
- **The grid is gridstack 14.** Arranging and resizing the deck work as
  before.
- **SvelteKit 3.** TilePier runs on SvelteKit 3.1 and its Cloudflare adapter 8.
  The API keeps its edge cache, which the adapter no longer provides, to the
  same rules, and the bot check still stands behind it.
- **The offline worker is a JavaScript module**, as SvelteKit 3 builds it.
  A browser too old to run one — Firefox before 147 — keeps the whole app and
  loses only offline use.
- **The licences page follows the Worker as it is deployed.** It lists
  esm-env, which SvelteKit 3 brings into the Worker, and no longer lists
  worktop and set-cookie-parser, which left with SvelteKit 2.

### Fixed

- **The toasts' buttons are 40 × 40**, the size every control outside a tile
  keeps. The dismiss button was 21 × 32.

### Security

- **DOMPurify 3.4.17.** It fixes a critical and a high advisory
  (GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr) in modes TilePier does not use,
  `SAFE_FOR_TEMPLATES` and `IN_PLACE`. Taken anyway.
- **Feeds are read in linear time.** Five patterns the Worker ran over what a
  feed's publisher wrote — dates, markup, the author line — took seconds on a
  stuffed input, and the `M/D/YYYY` date took 45 seconds at 8,000 spaces. They
  now read the text once, with the same results.
- **SvelteKit 3.0** clears two low advisories in SvelteKit 2
  (GHSA-pfhg-q3qv-9q6r, GHSA-27mw-82g8-phjj), in features TilePier does not
  use: enhanced form actions, and a prerendered page's `cache-control` taken
  from outside.
- Development tooling: Vite 8.3.5, and undici 7.30.1 and zod 4.6.7 underneath
  wrangler and knip.

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

[1.3.0]: https://github.com/poli0981/tilepier/releases/tag/v1.3.0
[1.2.0]: https://github.com/poli0981/tilepier/releases/tag/v1.2.0
[1.1.0]: https://github.com/poli0981/tilepier/releases/tag/v1.1.0
[1.0.1]: https://github.com/poli0981/tilepier/releases/tag/v1.0.1
[1.0.0]: https://github.com/poli0981/tilepier/releases/tag/v1.0.0
