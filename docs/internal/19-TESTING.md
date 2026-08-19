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

- `lib/core/**` and `lib/lunar/**`: **90 %** lines/branches.
- `routes/api/**`: **85 %**.
- Overall: **75 %**. Widgets' Svelte files are covered by component tests
  but exempted from line thresholds (UI churn); their `service.ts` files
  are not exempt.
- **`lib/core/grid/**/*.svelte` is exempt from the 90 % bucket** (carve-out
  added 2026-08-19, when the thresholds were first actually configured). Its
  contract is an invariant across fifty add/remove cycles — wrapper count,
  mounted host count and serialised tile count all agreeing — which only
  `e2e/s1-grid.e2e.ts` can express and which line coverage cannot see. That spec
  is the compensating control and is a required status check. No other file
  under `lib/core` is exempt.

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

## 5. Manual test matrix (release gate)

Browsers: Chrome, Edge, Firefox, Safari 17 (macOS), iOS Safari, Android
Chrome. Music FSA path: Chromium only + fallback verified on Firefox.
Reduced-motion, 200 % zoom, keyboard-only pass, screen-reader spot check
(NVDA) on dashboard + one detail.

## 6. Widget Definition of Done (per widget, tracked in PR template)

- [ ] Tile view at every allowed density tier (S/M/L as applicable)
- [ ] Detail view (if manifest declares one) incl. deep-link render
- [ ] All doc 06 §3 states implemented and component-tested
- [ ] i18n: zero hardcoded strings; en+vi keys complete (`i18n:check`)
- [ ] Offline behavior per doc 17 §3 class
- [ ] A11y: labels, focus order, contrast, chart summary line
- [ ] Perf: chunk size within budget (doc 20 §6); no scheduler leaks on
      remove (S1 discipline)
- [ ] Unit tests for its `service.ts`/logic; component test for states
- [ ] Spec doc cross-checked; deviations noted back into docs 07–09
