# 19 · Testing

## 1. Layers & tools

| Layer | Tool | Scope |
|-------|------|-------|
| Unit | Vitest 4 (node env) | pure logic: lunar engine, calc engine, swr, scheduler, migrations, formatters, QR/password/color utils, RSS normalizer, symbol validators |
| Component | Vitest 4 browser mode (`@vitest/browser-playwright` + `vitest-browser-svelte`) | widget states (loading/empty/stale/error), settings round-trips, a11y roles |
| API (Worker) | Vitest + adapter platform-proxy (miniflare-backed) | endpoint validation, KV cache hit/miss/stale, breaker transitions, envelope shapes |
| Mocked network | MSW 2 | upstream fixtures per API (recorded, trimmed) |
| E2E | Playwright (Chromium + Firefox + WebKit) | smoke journeys (§4) |

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
| `lib/widgets/music/**` | nothing yet — Week 0 spike code that landed in the real repo ahead of its consumer (doc 22 §Exit review). Re-enters with the music library in Week 7. **`lib/charts/**` came off this row on 2026-08-30**, when the weather detail became its consumer; it now sits in the global 75/75 bucket, and the split into `echarts.ts` / `options.ts` / `theme.ts` is partly what makes that reachable — the half worth asserting is pure |
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

## 4. Playwright smoke suite (fast, <3 min, every PR)

1. First run: legal gate → accept → default deck renders → coach dismiss.
2. Add widget → drag (edit mode) → resize → reload → layout persisted.
3. Open weather detail (MSW-fixture data) → chart canvas present → Esc
   closes → Back/forward behave.
4. Offline emulation: toggle offline → stale badges appear → tier-1
   widgets still work → online → refresh clears badges.
5. Notes: create, markdown preview renders, XSS string stays inert.
6. Export backup → wipe → import → deck + notes restored.
7. i18n: switch vi↔en → gate/labels/lunar footer switch, no missing-key
   text.
Markets/music E2E are manual-checklist in v1 (real APIs / real files);
their logic is unit/component-covered.

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

## 5. Manual test matrix (release gate)

Browsers: Chrome, Edge, Firefox, Safari 17 (macOS), iOS Safari, Android
Chrome. Music FSA path: Chromium only + fallback verified on Firefox.
Reduced-motion, 200 % zoom, keyboard-only pass, screen-reader spot check
(NVDA) on dashboard + one detail.

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
