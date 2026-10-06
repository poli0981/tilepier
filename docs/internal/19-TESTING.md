# 19 · Testing

## 1. Layers & tools

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest 4 (node env) | pure logic: lunar engine, calc engine, swr, scheduler, migrations, formatters, QR/password/color utils, RSS normalizer, symbol validators |
| Component | Vitest 4 browser mode (`@vitest/browser-playwright` + `vitest-browser-svelte`) | widget states (loading/empty/stale/error), settings round-trips, a11y roles |
| API (Worker) | Vitest + adapter platform-proxy (miniflare-backed) | endpoint validation, KV cache hit/miss/stale, breaker transitions, envelope shapes |
| Mocked network | MSW 2 | upstream fixtures per API (recorded, trimmed) |
| A11y | axe-core through `@axe-core/playwright`, WCAG 2.2 A + AA (`e2e/a11y`, Week 8) | every surface; targets ≥ 40 px outside tiles |
| E2E | Playwright — **Chromium only** (corrected 2026-09-29: `playwright.config.ts` has never defined `projects`, although `e2e.yml` installs all three; Firefox and Safari are §5's manual matrix) | smoke journeys (§4) |

Test files co-located: `foo.ts` + `foo.test.ts`; fixtures in
`src/lib/**/__fixtures__`. Vitest runs two projects (`vite.config.ts`): browser
tests match `src/**/*.svelte.{test,spec}.{js,ts}`, node tests match everything
else — so a component test **must** carry the `.svelte.` infix or it silently
runs in node and fails on DOM access.

## 2. Coverage targets (CI-enforced via Vitest thresholds)

- `lib/core/**` and `lib/lunar/**`: **90 %** lines, **80 %** branches.
  (Branches lowered from 90 on 2026-08-19, when the thresholds were first
  measured against real code rather than assumed. `lib/core` is deliberately
  defensive — every storage read is try/caught, every parse fails closed, every
  optional has a fallback, because doc 05 §5 and CLAUDE.md rule 10 require the
  shell to survive corrupt input. Those catch arms are branches written to never
  execute; covering each one asserts that a `catch` is present, not that any
  behaviour is right. The behaviours that matter — quarantine, the gate failing
  closed, dropping an unknown `widgetId` — each have an explicit test. Lines
  stays at 90: unreachable *statements* are dead code, which is a different
  thing.)
- `routes/api/**`: **85 %**.
- Overall: **75 %**. Widgets' Svelte files are covered by component tests
  but exempted from line thresholds (UI churn); their `service.ts` files
  are not exempt.
**Exemptions, all added 2026-08-19 when the thresholds were first configured.**
Each names what covers the code instead, because an exemption without one is
just a lower number:

| Excluded | Covered by |
|---|---|
| `lib/core/grid/**/*.svelte` | `e2e/s1-grid.e2e.ts` — the contract is an invariant across fifty add/remove cycles (wrapper, host and tile counts agreeing) that line coverage cannot see |
| `lib/core/pwa.svelte.ts` | `e2e/s5-pwa.e2e.ts`, against a real service worker: registers, activates, serves `/offline`, never reloads under the user |
| `lib/ui/**/*.svelte` | component tests and journeys #1/#2/#7. Same judgment this section already made for widget UI: shared chrome is markup and wiring, and line coverage of markup is weak signal. The `.ts` logic underneath stays inside the thresholds |
| `lib/widgets/music/tag-worker.ts` | the worker's message loop only — v8's browser coverage cannot see inside a worker, so the loop is all the file holds and `tags.ts` carries the logic the tests run directly. **The rest of `lib/widgets/music/**` re-entered on 2026-09-29** (Week 7a-1), in the global 75/75 bucket. **`lib/charts/**` came off this row on 2026-08-30**, when the weather detail became its consumer; it now sits in the global 75/75 bucket, and the split into `echarts.ts` / `options.ts` / `theme.ts` is partly what makes that reachable — the half worth asserting is pure |
| `routes/spike/**` | harnesses, not product |

Coverage runs via `pnpm test:cov` (`@vitest/coverage-v8`); plain `pnpm test`
stays fast and uncovered for the inner loop. CI runs the covered form.

## 3. Non-negotiable unit suites

1. **Lunar engine:** QuoteAtlas vectors carried over + leap-month years
   (2023, 2025, 2028…), 29/30-day boundaries, Tết dates 1990–2040 table,
   Can-Chi cycle checks, TZ-pinning test (viewer in UTC-8 sees same lunar
   day).
2. **Calc engine:** operator precedence, affine temperature, 12-digit
   rounding, divide-by-zero, locale formatting.
3. **Migrations:** every localStorage/Dexie migration has an
   old-shape→new-shape test + corrupt-JSON quarantine test.
4. **swr/scheduler:** dedupe, stale flag math, visibility pause/resume
   (fake timers), backoff caps + jitter bounds.
5. **Worker `_lib`:** TTL/stale windows per doc 11 §4 table. The test
   (`src/lib/shared-constants.test.ts`) **parses the markdown table out of
   `docs/internal/11-WORKER-PROXY.md`** and compares it against
   `shared-constants.ts`, so editing either side alone turns CI red. Reading
   only the constants module — as this line previously described — could never
   detect doc drift; corrected 2026-08-10 and verified by mutating a TTL in the
   doc and watching the suite fail. Also covers
   breaker open/half-open/close, quota guard tiers (720/780), rate-limit
   bucketing, SSRF url rejections (each rule in doc 15 §5), envelope
   shapes.
6. **Sanitizers:** DOMPurify configs (notes vs RSS) against an XSS corpus
   (script, event handlers, javascript: URLs, svg payloads, data: images).
   Both halves exist since 2026-09-25: `sanitize.svelte.test.ts` (notes) and
   `sanitize-rss.svelte.test.ts` (RSS — no image in any form, no relative
   link), each rule mutation-checked, plus a test that the two profiles'
   instances never share a hook. `ui/at-html.test.ts` counts the app's
   `{@html}`: exactly two, one per profile, each inside the component that
   runs its sanitiser.

## 4. Playwright smoke suite (fast, <4 min, every PR)

**Four minutes since 2026-10-06, raised from three on a measurement** — the
`N passed (Xm)` line of the e2e job, Chromium, two workers. Through Week 7 the
suite ran 2.2–2.5 min on CI (139–148 tests); Week 8's accessibility sweep
(`e2e/a11y.e2e.ts`, per-surface on every PR) took it to 3.3 min at 171. The
sweep stays per-PR because what it guards is per-PR, and its long half — every
detail in both themes — is nightly already. The job also stopped installing
Firefox and WebKit, which the suite never launches (that step took 67 s for all
three), outside this figure. A red run now uploads an HTML report with a
screenshot of each failure; until then no reporter wrote one and the artifact
was empty.

1. First run: legal gate → accept → default deck renders → coach dismiss.
2. Add widget → drag (edit mode) → resize → reload → layout persisted.
3. Open weather detail (MSW-fixture data) → chart canvas present → Esc
   closes → Back/forward behave.
4. Offline emulation: toggle offline → stale badges appear → tier-1
   widgets still work → online → refresh clears badges.
5. Notes: create, markdown preview renders, XSS string stays inert — and
   (2026-09-29) what was typed just before a reload is kept.
6. Export backup → wipe → import → deck + notes restored.
7. i18n: switch vi↔en → gate/labels/lunar footer switch, no missing-key
   text.
Markets E2E is a manual checklist in v1 (real APIs); its logic is
unit/component-covered. ~~Music's too (real files).~~ **Music is automated
since Week 7a** (doc 22 §S7): `showDirectoryPicker` is stubbed to return a
real OPFS folder of generated fixtures, and a lapsed grant is simulated by
every handle method throwing `NotAllowedError` (`e2e/_lib/fsa.ts`, shared with
the video since Week 7b).
`journey-music` picks a folder from the tile and plays it, imports files in
the detail and finds one without its accents, resumes after a lapsed grant in
one click, and resets the deck from Settings to prove the player stops with
no deck page to tell it. The audio really plays — Chrome for Testing has the
codecs and headless is muted, not stopped — and what the OS would show is
read from `navigator.mediaSession`, through an init script that records every
title and state written there (`e2e/_lib/session.ts`), because the fixture
songs last a second each.
Every one of those tests also asserts no CSP violation, collected by
`_lib/csp.ts` from both `securitypolicyviolation` events and the console.
What stays manual is what no stub can be — the OS dialog, the gesture, a
grant across a browser restart, the OS's own media controls. Since Week 7b-1
it also holds spike S2's 200-file import guard: under ten seconds, and the page
keeps drawing. That guard came over when `/spike/s2` and `e2e/s2-fsa` were
removed.

**`journey-media`** (Week 7b) does the same for the video. `showOpenFilePicker`
returns a file from an OPFS folder of the generated fixtures (doc 22 §S8), and
a second test deletes it, so the file input Brave and Firefox get is driven
through Playwright's file chooser. It covers:
- a picked video that plays, and the Media Session that sees it;
- an MP4 through the input;
- a file this browser cannot play, which says so and never takes the sound;
- sound with no picture, which says so and offers no picture-in-picture;
- the keys, from the focus the player takes when it loads;
- Escape, which does not close the detail out of full screen but does after;
- a reload in the middle of a video, then the same file picked again;
- subtitles from a SubRip file with a byte-order mark and CRLF, and C;
- after a reload, the tile's still and its Continue opening the video from its
  handle; a recent the browser refuses, then one whose file is gone, and
  Forget.

The reload test itself now opens its video through the `<input>`: one from
the picker comes back as a recent, and the input's is the path that is picked
again by name and size.

The reload test is the one that found `pagehide` writes lost (doc 04 §6): it
plays past the seek's own save, so only the closing page can keep the place.

**Written so far** (2026-08-28): #1, #2, #4, #5, #6 and #7, plus three supporting
specs that are not numbered journeys — `legal-gate`, `error-pages` and
`detail-expansion`. The last covers doc 06 §6's handshake, which journey #3
would otherwise take for granted when the weather detail lands in Week 4. **103
e2e as of 2026-08-31**, in about thirty seconds — Week 4 added five, all of
them assertions the suite could not previously make: `s1-grid` measures
gridstack's item inset (doc 06 §5 rule 12), drags a tile past each end of its
manifest's size range and loads a deck seeded outside it (rule 14), and
`journey-2` reloads a deck whose tiles collide on insertion and checks that all
of them are still in storage afterwards (rule 13). Every one was verified
against the unfixed code first; a regression test written after a fix and never
seen to fail is a regression test in name only.

The rule 14 tests earned that twice over. Run against the wired-up bounds but
the old `serialise`, the load one failed again on a *different* fault — the grid
showing a clamped 2×2 while the emitted layout still said 1×1 — which is how
`grid.save()`'s habit of omitting a `w` that equals `minW` was found at all. It
was not written with that in mind; it simply asserts that the DOM and the
serialised layout agree, and that is the assertion that catches a divergence
whichever side causes it.

Three things about driving a gridstack resize from Playwright are written into
`s1-grid`, because none is guessable and each cost an hour.

**The default 1280 viewport is not a twelve-column grid.** It lands on §5.4's
`{w: 1280, c: 6}` breakpoint, and `engine.save()` then reports the cached
twelve-column layout in preference to the live nodes, so a drag shows on screen
and not in the serialised layout at all. The viewport is declared through
`test.use` rather than set mid-test for a second reason: resizing after the grid
has mounted starts a column recalculation that moves every tile, and a
`boundingBox()` read before that settles aims the pointer where a tile used to
be. Locally it settles first; on CI it does not.

**Revealing a resize handle takes a mouseout → mouseover pair**, not a move onto
the tile: gridstack's `_mouseOver` returns early while
`DDManager.overResizeElement` is set, and `_mouseOut` clears it only for the item
being left, so a pointer left sitting inside a tile can wedge every handle in the
grid shut. That one only ever failed on CI.

**And an injected resize does not reliably produce a `change` event at all** —
measured at two runs in eight. The tile ends the clamped size on screen and its
`gs-w` says so, while `onLayoutChange` has fired exactly once for the whole test,
which is the mount emit. Ending the gesture inside the tile rather than at its
corner did not help and settling moves before the release made it worse, so the
cause is **not** understood. The two drag tests therefore assert `gs-w`/`gs-h`
and the load test carries the serialisation claim, which is the one that has no
gesture in it and the one that caught the `serialise()` fault. **Whether a real
pointer can lose a resize the same way is open and worth answering on its own**:
if it can, a user's resize silently fails to persist, and no test arrangement
would fix that.

**#4 is complete since 2026-08-31**, and the clause that looked unreachable
turned out not to be. “online → refresh clears badges” has no trigger at
`currency`’s 12 h cadence — `scheduler.execute`’s `finally` recomputes
`nextDueAt` from the cadence and `wake('online')` skips anything not yet due, so
neither a reconnect nor a reload revalidates a young entry. The honest trigger
is the entry genuinely ageing past the client TTL, and `page.clock.setFixedTime`
arranges that without faking a timer the app depends on: thirteen hours on, the
tile revalidates, meets a refusal, and raises the `stale-error` badge doc 13 §7
gives a retry button. The alternative considered and **not** taken was to call
the retry button “refresh” and move on — an unexplained substitution is how a
journey quietly stops testing the thing it is named after.

What follows is the note as it stood while the second half was outstanding.

**#4 was half written, and the written half was the half that existed.** Its stale
badges need a widget with cached network data, and the first of those is weather
in Week 4. What Week 3 could assert is the rest of that sentence — the offline
chip appearing and clearing, and a deck made entirely of local widgets being
*unchanged* rather than degraded. It was worth writing on its own: it found two
real faults on its first run (`online.init()` never called, and an added widget
mounting an empty tile), neither of which any other test could have seen.

**#3 is written** (2026-08-30), and it brought a mechanism the suite did not
have: **a faked response**. Everything before it either needed no network or
drove `context.setOffline`. MSW is wired for the node project only — there is no
`mockServiceWorker.js` in `static/`, and doc 15 §6 keeps msw's postinstall
denied — so journey #3 uses Playwright's own `page.route`, which the service
worker leaves alone because it passes `/api/*` straight through. That is the
mechanism every later networked journey should copy.

It asserts the **canvas**, not the panel: the chart module is a separate lazy
request, so "the detail opened" would pass with the chunk still in flight and
the picture never drawn.

One rule this suite learned the hard way, recorded because it has now cost a
red CI run: **never click a full-viewport scrim at its midpoint.** A panel
centred on top of it occupies exactly that point, so the click lands on the
panel — or does not, depending on how far through an opening animation it has
got, which differs between a developer's machine and a runner. Use
`{ position: { x: 4, y: 4 } }`.

A second of the same kind, added 2026-08-28 for the component suite: **never
assert a spy straight after a click** — wrap it in `vi.waitFor`. A locator's
`.click()` resolves when the click is dispatched, not when whatever it caused
has finished, and on a cold run (Vite re-optimising its dependency graph while
the first file executes, which adding files to the project triggers) the gap is
wide enough to lose. It cost one red `test:cov` on a timer assertion written in
Week 2 that had passed every run until the Week 3 files landed beside it.
Everything else in that file already went through `waitFor` or `expect.element`,
which is the same wait by another name; the one that did not was the one that
broke.

And a third, which is the corner rule's other half: **the browser project pins
`browser.viewport`**. Without it Vitest sizes each file's iframe by how many
files are running beside it, so a centred detail panel can cover the scrim's own
corner and the corner rule stops working — silently, and only once someone adds
a test file. `e2e/TpDetailOverlay`'s scrim click had followed the rule since
Week 2 and started failing on the run that added the Week 3 files, in isolation
passing every time. Pinned at 1280×800 in `vite.config.ts` on 2026-08-28.

And a fourth, for Playwright: **seed `localStorage` with `addInitScript` before
the first navigation, never with `evaluate` after it.** The old pattern —
navigate, `setItem`, reload — has a race that stayed invisible while the seeded
deck was two tiles: gridstack compacts a four-tile grid on mount and emits
`change`, the deck store schedules a debounced write (doc 04 §6), and the
reload's `pagehide` flushes that write *over* whatever the test just put there.
Four tests then failed somewhere unrelated to what they were checking.
`e2e/_lib/seed.ts` does it before any page script runs, and applies once — an
init script stays registered for every later navigation, so a test that seeds a
timer, starts it and reloads would otherwise have the seed put back over the
state it was reloading to check.

And a fifth, which is about what a suite *cannot* see rather than how to write
it: **assert geometry somewhere, or a layout bug ships.** `e2e/s1-grid` counted
wrappers, hosts and tiles, round-tripped layout JSON and dragged tiles through
fifty cycles, and none of that could notice that every tile was painting
edge-to-edge — gridstack's `margin: 12` was correct in the JS options, so the
model, the collisions and the drop targets were all right and only the paint was
wrong (doc 06 §5 rule 12). Until 2026-08-30 the four `boundingBox()` calls in the
whole `e2e/` tree existed solely to compute a mouse origin for a drag, and there
was no `toHaveScreenshot` anywhere. `s1-grid` now asserts the item's four insets
directly — one item, not the distance between two, so it holds at every column
breakpoint.

And a seventh, for the browser project, found 2026-09-01 building the markets
tile: **`scheduler.tick()` does nothing in a component test, because the
headless browser can report `document.visibilityState: 'hidden'`.** The
scheduler stops the ticker entirely on `hidden` (doc 04 §3), which is correct
and is also why driving a widget's cadence from a browser test silently runs
nothing — the assertion then fails on the state that never changed rather than
on the tick that never happened.

The case in question was "a refusal lands on cached prices, so the badge is
`stale-error`". It is written through the **hydrate** path instead: seed
`apiCache` with a payload aged past the client TTL, stub the refusal, and
render. That is a reload while rate-limited, which is more faithful to what a
reader meets than a synthetic tick, and it needs no timer at all. The scheduler
tests that *do* drive `tick` live in the node project, where `document` is a
stub whose visibility the test owns.

And a sixth, which is about a helper rather than a test: **`expect.poll`
retries a mismatched value, but lets a thrown error through.** `journey-6`'s
`awaitStoredTiles` polls `page.evaluate` while waiting for the backup restore to
finish — and the restore *reloads* when it finishes, so roughly one run in four
the poll landed on the teardown and failed with "Execution context was
destroyed": the helper broke on the very event it existed to wait behind. A poll
that watches something across a navigation has to catch and return a sentinel,
not assume the page is still there. (2026-08-30.)

`SEEDED_TILES` lives in the same file for the same kind of reason: doc 13 §9's
first-run deck grows as widgets land — 1 in Week 1, 2 in Week 2, 4 now — and six
files each carried the number as a literal.

`acceptGate` joined them in `e2e/_lib/gate.ts` on 2026-09-25, from eight
copies, before the rss journey (`e2e/rss.e2e.ts`) became a ninth. Its
`dismissCoach` option is journey #4's variant, which also clears doc 13 §9's
coach before clicking a tile.

**The accessibility sweep** (`e2e/a11y`, Week 8) runs axe-core at WCAG 2.2 A
and AA over every surface a reader meets, and holds every control outside a
tile to doc 13 §8's 40 px (`expectTargets`). A PR scans each kind of surface
once — the light theme throughout, the dark gate, deck and settings, and the
375 px deck and sheet; the schedule adds every detail in both themes and the
prose pages (`@nightly`, which `e2e.yml` leaves out of PR runs). `/api/*`
answers 503, so no scan depends on an upstream and each networked widget's
error state is scanned too. Three things it taught:
- **The deck must hold all fifteen widgets.** `/w/<id>` for a widget that is
  not on the deck offers to pin it instead of showing the detail; the first
  draft scanned ten "details" that were pin offers.
- **Scan settled pixels.** A panel caught mid-fade blends with the page and
  reads as a contrast failure no reader sees; `expectClean` waits for every
  finite animation first (a looping one, like a loading gauge, never ends).
- **What it found** is in doc 13 §8 and doc 07 §3: the calendar's neighbouring
  months in the disabled grey, a skeleton named without a role, two controls
  without names, and the calculator's 17–19 px keys — with the 40 px rule
  itself unheld across the chrome and the details.

And an eighth, found on 2026-10-06: **no test had ever seen a scrollbar.**
Playwright launches headless Chromium with `--hide-scrollbars`, in this suite
and in Vitest's browser mode alike, so every width the suite measured was taken
with scrollbars zero pixels wide — on Windows a page scrollbar takes about 15.
That is how the deck could flip from 12 columns to 6 when edit mode made the
page scroll, with every layout assertion green (doc 06 §5.4).
`e2e/scrollbars.e2e.ts` drops the flag with `ignoreDefaultArgs` and is the one
place a scrollbar's width can break a layout. On CI it requires a scrollbar
wider than 0 rather than skipping, so it cannot pass by testing nothing.
`test.use({ launchOptions })` *replaces* the config's launch options rather
than merging, which is why the certificate flag and the hermetic host rules
live in `e2e/_lib/launch.ts` for both to share. A computed style
(`scrollbarWidth`, `scrollbarGutter`) is visible under the flag too; a pixel
width is not.

## 5. Manual test matrix (release gate)

Browsers: Chrome, Edge, Firefox, Safari (macOS), iOS Safari, Android Chrome —
the last two majors of each, iOS 17 at the oldest, as doc 02 targets (Version
and CVE policy, item 8). (This
line said "Safari 17" until Week 8, two majors behind that target; the
scrollbar colour of doc 12 §9 needs Safari 26.2, and older Safari draws its own
scrollbar, which is the fallback.) Music FSA path: Chromium only + fallback verified on Firefox. Brave is
Chromium without File System Access (switched off by default), so it is a
fallback browser too: 100+ songs imported and played there, and in Firefox, on
production on 2026-09-29 (doc 22 §S7).
Reduced-motion, 200 % zoom, keyboard-only pass, screen-reader spot check
(NVDA) on dashboard + one detail.

Added 2026-09-23, because the suite cannot reach these (its browser maps the
Cloudflare hosts to nowhere, and CI has no Turnstile secret):

- **Turnstile on production:** a fresh profile passes silently. A
  `3x…FF` testing sitekey locally (`.dev.vars`) opens the interactive dialog,
  which takes focus. A `2x…` pair shows the failure notice, and its retry
  works.
- **Beacon:** loads with no CSP console error, and a POST to
  `cloudflareinsights.com/cdn-cgi/rum` answers.
- **localStorage** still holds exactly the three keys after both have run.
- **Cookies** (added 2026-09-29, `LEGAL_VERSION` 3): on a fresh profile, after
  the check, DevTools shows exactly one cookie for this site, `cf_clearance`,
  `Secure` and `Partitioned`, and its expiry matches the privacy page. A profile
  that had accepted version 2 sees the gate again, with the cookie in its
  "what changed" line.
- **curl** without a pass and with a cache-busting parameter gets `401`; with
  the operator's bearer it gets `200`.
- **Security headers** (added 2026-10-06): `S3_BASE_URL=https://tilepier.win
  pnpm exec playwright test e2e/prod-headers.e2e.ts` passes — a prerendered
  page, a legal page and a Worker-rendered 404 each carry doc 15 §2's list
  exactly, `frame-ancestors 'none'`, and no cookie. The zone sits between the
  Worker and the reader, so only this run sees what a zone setting adds or
  rewrites.

And for the stock half of `markets` (Week 5b), which needs the deployed keys:

- **A fresh markets tile** shows BTC, ETH, AAPL and MSFT; outside US hours the
  two stocks are marked "close". A watchlist of only stocks lists, and never
  sits on a skeleton.
- **The detail on a stock:** 1D draws fifteen-minute candles, and 1W, 1M and 1Y
  each draw their own window — switching 1Y → 1M → 1Y never shows one range's
  candles under another's label. Both credit lines and the stock footnote are
  in the footer.
- **Search-add:** "apple" offers AAPL with its company name, a held symbol is
  disabled, and adding one writes the row to the tile.
- **The keyed S3 run** (`e2e/s3-quota.e2e.ts -g keyed`, doc 22 §S3) passes
  against production and its spend line is recorded there.

This is the **Week 8 release gate** and is not run per week. What *is* worth
doing at each milestone is a spot check of the surfaces that week added, on the
deployed build — the charter's QA strategy is dogfooding in production, and a
milestone nobody has looked at is not one.

**Week 3 spot check, 2026-08-28, on production.** All clear. The endpoint half
was checked by request: `/api/geocode` answers normalised results and reports
`x-tp-cache: HIT` on a second call with `cache-control: max-age=43200`, which is
half the 24 h TTL doc 11 §2 specifies — so the KV cache and the header rule are
both right on a real PoP rather than in a stubbed test. `/api/weather` returns
the normalised `TpWeatherPayload`: 48 hourly rows trimmed from upstream's 168,
7 daily, AQI bundled, attribution in the payload. That is the first time doc 10
§2 has actually held.

The interface half was checked by hand, because it is the half no test in this
repo can settle. The deck's four seeded tiles, the lunar line on the clock and
the lunar footer on the quote, a vi↔en switch moving can-chi and every label,
calendar event CRUD with the converter and the observance list, and the
diagnostics tables behind `?debug=1`. **And a QR of Vietnamese text scanned with
a phone** — `qr.test.ts` says outright that it can prove the byte encoding and
not the symbol, since no decoder is available to it; a phone is the decoder, and
this is the step that closes that gap. Everything returned what was expected.

The browser sweep, keyboard-only and NVDA remain Week 8 work and have not been
run.

**Week 2 spot check, 2026-08-27, on production.** All clear. The tier-1 widgets
and the detail overlay were exercised by hand after deploy, and the layout held
to **500 % zoom** without breaking — two and a half times the matrix's own
figure, and worth recording because the grid collapses by *grid width*
(doc 06 §5.4) rather than by viewport width, so it was not obvious the
breakpoints would behave at that extreme. The rest of the matrix above — the
browser sweep, keyboard-only and NVDA — remains Week 8 work and has not been
run.

## 6. Widget Definition of Done (per widget, tracked in PR template)

The PR template (`.github/pull_request_template.md`, Week 8) carries these
nine boxes; it did not exist before, so until then they were tracked in the
records below and in each week's PR bodies.


- [ ] Tile view at every allowed density tier (S/M/L as applicable)
- [ ] Detail view (if manifest declares one) incl. deep-link render
- [ ] Every doc 06 §3 state **required for this widget's doc 17 §3 class**
      implemented and component-tested; the states that class marks N/A are
      named in the PR rather than quietly skipped (doc 06 §3 table, added
      2026-08-27 — this line previously read "all states", which no tier-1
      widget can honour)
- [ ] i18n: zero hardcoded strings; en+vi keys complete (`i18n:check`)
- [ ] Offline behavior per doc 17 §3 class
- [ ] A11y: labels, focus order, contrast, chart summary line
- [ ] Perf: chunk size within budget (doc 20 §6); no scheduler leaks on
      remove (S1 discipline)
- [ ] Unit tests for its `service.ts`/logic; component test for states
- [ ] Spec doc cross-checked; deviations noted back into docs 07–09

**`currency`, 2026-08-31 — all nine met.** Recorded here because two of the
boxes need naming rather than ticking.

- **Density.** `min` is 2×1, so tier S is reachable and all three tiers are
  exercised. At h=1 the tile is one line carrying `{amount} {base} =
  {converted}` — a bare number there is a quantity with no unit attached to it
  — and no controls at all. The loading skeleton is one bar rather than two,
  which is doc 08 §3's quote post-mortem applied instead of rediscovered.
- **States.** doc 17 §3 puts `currency` in the cached-data class, so all seven
  are required and implemented. `permission-needed` is **forbidden rather than
  absent**: the manifest declares no `permissions`, and doc 06 §3 makes the
  state required exactly when it does. Named here per that section's rule, and
  asserted against the manifest in the component tests so it stays true if
  someone adds a permission without reading this.
- **A11y.** The chart's summary line carries the pair, the range, the move and
  the band it moved in. The 24 h change is signed by `Intl` before it is
  tinted, so colour is reinforcement rather than the channel (doc 12 §4.2).
- **Deviations noted back.** Three, all in doc 08 §2: the attribution link is
  not visible at h=1 (doc 16 §5 carries the same note and the escalation), the
  change column is absent rather than zero before a second day is recorded, and
  the cross rate is computed client-side because doc 11 §3 gives `/api/fx` no
  parameters.

**The other fourteen, 2026-10-06 (Week 8) — all nine boxes met, after a pass
that found what they were missing.** Writing these up was an audit, not a
formality: each box was checked against the code and the tests, and where one
was not met it was fixed before it was ticked (PR 8b-1b). What that pass
found and fixed:

- **notes and todo showed a failed read as empty** — "no notes yet", with an
  offer to write the first, to a reader whose notes the tile could not read.
  They say so now, with a retry. Neither tile had a component test; both do.
- **A weather place could not be changed** once picked, except by removing the
  tile; doc 08 §1 had put the picker in the detail and it was never built.
- **The quote detail lacked the copy and the lunar date** that the one-row tile
  drops on the promise that the detail keeps them.
- **The markets symbol search said "unavailable" when the reader was offline**,
  after spending a request on it.
- **The host's crash card** — the `error` state of clock, timer, notes and
  todo — had no test.
- **Untested states and tiers:** map's `loading`, `offline` and `error`;
  weather's `stale-error`; music's `loading`; the calculator's tape; tier L of
  clock, timer, calendar, toolbox, weather and notes, tier S of quote, tier M of
  music and todo; the clock's own timer on unmount; markets' two sources on
  unmount.
- **calendar had no as-built record** (doc 07 §6), and four doc lines had
  outlived the code.

Four boxes are met the same way by every widget, so they are recorded once:

- **Detail and deep link (2).** Every manifest declares a detail, and
  `/w/<id>` prerenders for each. The nightly sweep renders all fourteen deep
  links in both themes (`e2e/a11y.e2e.ts`); per PR, the light-theme scan
  covers the notes, calendar, weather and music details, and
  `detail-expansion.e2e.ts` and journey 3 load the clock's and weather's
  detail by URL.
- **i18n (4).** `i18n:check` and `i18n:audit` gate CI, and no widget file
  carries an exception.
- **A11y (6).** The axe sweep above; the contrast suite, any accent, both
  themes; chart summary lines where a chart is drawn — weather, currency,
  markets — each asserted. The timer's history bars carry labels and are the
  one chart-like view without a summary test.
- **Perf (7).** The budget gate: the largest tile chunk is 2.7 KB of 40
  (markets) and the largest detail 8.4 KB of 350 (media). No leak on remove:
  the host and `s1-grid` for every tile, plus the widget's own unmount test
  where it holds anything (the table's last column).

| Widget   | Tiers rendered (sizes) | States, by doc 06 §3 class — and what the class makes N/A                                                                        | Offline (5)                              | Tests (8)                                                          | Unmount            | Deviations (9) |
| -------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------ | ------------------ | -------------- |
| clock    | S M L (2×1–6×3)        | pure-client; `loading`, `empty` N/A (doc 07 §1); `error` the host's                                                              | local                                    | tile, service; detail by `detail-expansion` (9)                    | its own interval   | doc 07 §1      |
| timer    | M L (2×2–4×3)          | pure-client; `loading`, `empty` N/A (doc 07 §2); `error` the host's; `permission-needed` (notifications)                         | local                                    | tile, service, history; detail by `timer.e2e`                      | s1-grid            | doc 07 §2      |
| calc     | M L (2×2–4×4)          | pure-client; `loading` N/A; `empty` the tape; `error` inline                                                                     | local                                    | tile, detail, engine, convert                                       | —                  | doc 07 §3      |
| notes    | M L (2×2–6×6)          | pure-client; all four, `error` a failed read (fixed)                                                                             | local                                    | tile (new), service, storage; journey 5                             | —                  | doc 07 §4      |
| todo     | M L (2×2–4×6)          | pure-client; all four, two `empty`s, `error` a failed read (fixed)                                                               | local                                    | tile (new), service, storage                                        | —                  | doc 07 §5      |
| calendar | M L (2×2–6×5)          | pure-client; `loading`, `empty` N/A on the tile (doc 07 §6, new); `error` inline; the detail's empty day                         | journey 4                                | tile, detail, service, storage                                      | midnight task      | doc 07 §6      |
| toolbox  | M L (2×2–4×4)          | pure-client; `loading` N/A; `empty` ×2; `error` inline                                                                           | journey 4                                | tile, detail, service, color, password, qr                          | —                  | doc 07 §7      |
| weather  | M L (2×2–6×4)          | cached-data, all seven; `permission-needed` (geolocation)                                                                        | badge over data; card with none          | tile, detail, service, chart; journey 3                             | scheduler + cache  | doc 08 §1      |
| quote    | S M L (2×1–6×3)        | pure-client; `loading`, `error` inline; the detail's no-match                                                                    | journey 4                                | tile, detail, service                                               | midnight task      | doc 08 §3      |
| rss      | M L (2×2–6×6)          | cached-data, all seven (`stale` at the service level); `permission-needed` forbidden, asserted                                    | card                                     | tile, detail, opml, pacing, service; `rss.e2e`                      | scheduler + cache  | doc 08 §4      |
| map      | the tile has no tier-dependent layout; 4×3 and the no-WebGL card | map class: `stale`, `stale-error` N/A; `loading`, `offline`, `error`, no-WebGL; `permission-needed` (geolocation) | card                                     | tile, detail, places, TpMap; `map.e2e`                              | WebGL context      | doc 08 §5      |
| markets  | M L (2×2–6×6)          | cached-data, all seven; `permission-needed` forbidden, asserted                                                                  | card; badge; search says so (fixed)      | tile, detail, service, chart                                        | 2 entries + caches | doc 09 §1      |
| music    | S M L (2×1–6×3)        | media class: `loading`, `ready`, `empty`, `error`; `permission-needed` (fsa)                                                    | local files                              | tile, library, queue, playlists, collection, player, tags; journey   | player stops       | doc 09 §2      |
| media    | M L (2×2–8×5)          | media class: `loading`, `ready`, `empty`, `error`; `permission-needed` forbidden, asserted                                     | local files                              | tile, player, picker, poster, recents, resume, session, keys, subtitles; journey | track + URL released | doc 09 §3 |

Named rather than ticked, and left as they are: the clock's and the timer's
details are exercised end to end rather than by a component test; rss's
`stale` is asserted at the service level, where the rule lives; and two test
fixtures carry a tier label the host would not give their size (rss's 3×4 "M",
map's 4×3 "M") — harmless, since what each tile reads is the label or the
pixels, but worth knowing before trusting one as a sample of its tier.

## 7. Severity (P0–P3)

Defined 2026-10-06. The charter's release bar is "zero P0/P1 open bugs at tag
time" (doc 01), and neither level had a definition, so the bar could not be
measured. A bug takes the highest level any row fits, set by the maintainer at
triage as a label on the issue (doc 18 §3). Where two readings are possible,
take the higher and say why in the issue.

| Level | What it is | For example | At release |
| ----- | ---------- | ----------- | ---------- |
| **P0** | Data lost; a security or privacy exposure; the shell, the gate or the deck unusable | a restore that brings back less than the backup holds; a reader's data leaving the device unasked; a security header or the CSP gone; a deck that does not render | Blocks every release. Fixed, or rolled back (doc 21 §4), the day it is found |
| **P1** | A widget's main job broken; a legal obligation unmet; a WCAG 2.2 A/AA failure that blocks a task | a tile that never leaves its skeleton; an old number shown as current; a missing credit or disclaimer (doc 10 §8, doc 16 §4–5); a control with no keyboard path | Blocks a release: no tag while one is open |
| **P2** | Wrong, with a way round it; a secondary function broken | a detail that needs a reload to update; a layout that degrades at one density; an A/AA failure with an equal alternative beside it | May ship, named under "Known limitations" in `CHANGELOG.md` |
| **P3** | Cosmetic: copy, polish, an inconsistency that misleads nobody | a glyph a pixel off; a misworded note in `?debug=1` output | Whenever |
