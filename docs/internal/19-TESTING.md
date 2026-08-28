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
| `lib/charts/**`, `lib/widgets/music/**` | nothing yet — Week 0 spike code that landed in the real repo ahead of its consumers (doc 22 §Exit review). Re-enters with charts in Week 4 and the music library in Week 7 |
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
would otherwise take for granted when the weather detail lands in Week 4. **98
e2e in total**, in about thirty seconds.

**#4 is half written, and the written half is the half that exists.** Its stale
badges need a widget with cached network data, and the first of those is weather
in Week 4. What Week 3 could assert is the rest of that sentence — the offline
chip appearing and clearing, and a deck made entirely of local widgets being
*unchanged* rather than degraded. It was worth writing on its own: it found two
real faults on its first run (`online.init()` never called, and an added widget
mounting an empty tile), neither of which any other test could have seen.

**#3 waits for Week 4** with the weather detail and its chart, as doc 23 says.

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
