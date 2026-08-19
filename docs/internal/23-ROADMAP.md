# 23 · Roadmap — 8 Weeks to v1.0

Solo-dev cadence; each week ends with a working deployable `main`.
Milestone tags `v0.<week>` deployed to production domain from Week 1
(dogfooding in prod is the QA strategy).

## Week 0 (≈5 days) — Spikes · **COMPLETE 2026-08-10, gate open**
S1–S5 per doc 22 + exit review. **Gate:** all spikes green-or-fallbacked.

All five green. S3's hit-rate measurement was completed on the deployed Worker
on 2026-08-10 — **94 % against a ≥ 85 % criterion, 0 MISS after warm-up** — so
the doc 11 §5 load model holds. Its stock half still needs a keyed run before
Week 5. The ~6 % HTTP 500 seen at 200-concurrency was traced to the soft rate
limiter's hot KV key and fixed; the final measurement is 100 %, 0 errors. No fallback was forced except S5's, taken deliberately. Findings and the adjusted Week 1 backlog are in
doc 22 §Exit review.

The budget was ≈4.5 days, which was arithmetic that omitted the exit review —
S1–S5 sum to exactly 4.5 and the review is another half-day. Corrected above.

Week 1 starts with more in hand than planned, because the bootstrap-then-spike
decision (doc 01 log) meant the spikes were built in the real repo: TpGrid and
TpWidgetHost, the Dexie schema, shared-constants, the legal gate, security
headers, the service worker, the bundle-budget gate, and CI all landed in
Week 0 and are merged.

## Week 1 — Shell · **COMPLETE 2026-08-19, M1 met**
~~Repo init~~ · ~~scaffold + tokens + fonts (doc 12)~~ · ~~TpGrid + host~~ +
layout persistence/migrations · registry + add/remove drawer · settings page +
store · Paraglide EN/VI · ~~legal gate~~ + static legal pages (real text) ·
error pages + ring buffer · branch protection.
**Milestone M1:** empty deck you can arrange, in both languages, deployed.

Shipped, in eleven commits plus one correction: versioned localStorage with
migrations and corrupt-quarantine · the settings store and `/settings` · the
console ring buffer, client error hooks and `+error.svelte` · Paraglide EN/VI on
a settings-backed custom strategy, with bilingual prerendering for the gate,
`/legal/*`, `/about` and `/offline` · real bilingual legal texts and the
attribution register · `/about` with its two documented limitations · the widget
registry and the central scheduler with the `unregister()` doc 19 §6 needs · the
clock tile, pulled forward from Week 2 · layout persistence and the deck store ·
the top bar, add-widget drawer, edit-mode chrome and first-run coach · the bug
report dialog · coverage thresholds and the branch-protection ruleset.

**Deferred out of Week 1, each with a reason rather than a slip:** backup
export/import and Playwright journey #6 move to Week 2, where notes and todos
give them something to round-trip (doc 05 §6); `swr()` is specified in doc 04 §2
and implemented in Week 3 with its first real consumer; the clock detail view
and the lunar date line follow in Weeks 2 and 3; the per-tile settings control
(⚙) waits for a widget whose settings are worth a popover; and `licenses:gen`
remains a Week 8 script, with `/legal/licenses` shipping the curated register
that no generator could produce.

Numbers at the milestone: 271 unit and component tests, 70 e2e across six
consecutive clean runs, 93.3 % lines and 82.6 % branches, entry chunk 2.4 KB gz
of a 200 KB budget, zero hardcoded strings, 139 message keys with no drift.

Struck items landed in Week 0 — the bootstrap-then-spike decision meant the
spikes were built in the real repo rather than thrown away.

Three remaining items need a **specification decision before code**, all
surfaced by the Week 0 review and all genuine gaps rather than deferred work:
the **settings page** has no section in any doc; **Paraglide** has no inlang
project config or locale strategy beyond "`messages/{en,vi}.json`"; and
**`swr()` / `scheduler.register()`** have no return shapes, which the entire
data layer sits on. Resolve each in the doc before writing what it governs.

**Resolved 2026-08-19**, all three, plus the smaller gaps the review listed —
settings is doc 13 §10, Paraglide's config and strategy are doc 14 §1, and the
two data-layer contracts are doc 04 §2–3. Also amended: doc 05 §2/§5, doc 06
§1/§5/§7, doc 12 §2/§2a, doc 13 §9/§11, doc 14 §4/§6, doc 16 §5, doc 17 §1/§3,
doc 18 §1/§5, doc 19 §2, doc 20 §5, doc 21 §7, doc 03.

Week 1 additionally pulls **`clock` (tile only)** forward from Week 2: the
registry, the add/remove drawer, layout persistence and Playwright journey #2
all need at least one addable widget to be testable at all. Week 2 deepens it
(detail view, density tiers, all doc 06 §3 states) and is four widgets instead
of five.

`swr()` is **specified** in Week 1 and implemented in Week 3, when `/api/weather`
gives it a real consumer. `scheduler()` is specified **and implemented** in
Week 1, because its `unregister()` path is what doc 19 §6's "no scheduler leaks
on remove" rests on, and `TpWidgetHost` wires that teardown from the start.
Backup export/import (doc 05 §6) moves to Week 2, when notes and todos give it
something to round-trip.

## Week 2 — Tier 1, batch 1
clock detail (world clock; the tile shipped in Week 1) · timer
(+focusSessions) · calc · notes · todo — tiles + details + states + tests per
DoD · backup export/import (doc 05 §6) + e2e journey #6, now that there is data
to round-trip. **M2:** the deck is already a usable daily tool.

## Week 3 — Tier 1, batch 2 + proxy skeleton
calendar + lunar module port w/ test vectors · toolbox · quote ·
`/api/_lib` pipeline (KV cache, limiter, breaker, envelope) + `/api/weather`
+ `/api/geocode` live. **M3:** first networked data flows end-to-end.

## Week 4 — Weather · Currency
weather widget+detail (ECharts bridge built here, theme-linked) ·
fx endpoint + snapshot mechanism + currency widget/detail (history chart
against accumulating snapshots) · offline/stale polish pass on both.
**M4:** tier-2 pattern (swr + proxy + echarts) proven and documented back.

## Week 5 — Markets
crypto ticker/klines endpoints · stock quote/series/search endpoints
(budget guard + breaker + Stooq fallback) · markets tile + detail
(candles, ranges, watchlist) · degradation ladder verified by fault
injection. **M5:** the hardest widget done; quota telemetry watched for a
full week from here.

## Week 6 — Map · RSS
maplibre integration + geocode UI + saved places · rss endpoint (SSRF
guards + parser fixtures) + reader UI + OPML. **M6:** all networked
widgets complete.

## Week 7 — Music · Media
FSA + fallback ingestion, worker tag parsing, playback + Media Session +
playlists + resume · media player + subtitles + PiP. Visualizer only if
green on schedule (declared cut-line). **M7:** feature-complete.

## Week 8 — Hardening & Release
PWA per S5 outcome · a11y audit (contrast pairs, focus, SR pass) · perf
pass vs budgets · full manual matrix (doc 19 §5) · doc 10 §8 compliance
checklist · security header verification · public `README.md` (features,
screenshots, self-host guide) + CONTRIBUTING + SECURITY.md · CHANGELOG ·
tag `v1.0.0` → release workflow → notify.

## Release checklist (Week 8 gate, condensed)

- [ ] All widget DoDs checked (doc 19 §6) · zero P0/P1 bugs
- [ ] Budgets green in CI · Lighthouse targets met (doc 01)
- [ ] doc 10 §8 attribution/compliance all checked
- [ ] Legal texts final (vi+en) · LEGAL_VERSION=1 · gate verified pre-JS
- [ ] Secrets grep clean (doc 21 §5) · headers verified in prod
- [ ] Backup export/import round-trip on prod build
- [ ] Rollback runbook tested once (deploy previous version)
- [ ] Repo hygiene: topics, description, social preview, issue templates

## Post-1.0 parking lot (v1.x candidates, not commitments)

per-breakpoint saved layouts · music visualizer + Safari FSA-adjacent
improvements · VN equities (behind flag, source TBD) · quote-as-image ·
calendar year view (worker-calc) · widget instances export as shareable
preset · Turnstile if abuse appears · BroadcastChannel tab sync.

## Slip policy

Order of sacrifice if a week overruns: 1) visualizer, 2) media subtitles
(.srt convert), 3) OPML, 4) quote browse-detail (keep tile), 5) push
media widget whole to v1.0.1. The 15-widget count is protected by cutting
depth, not widgets.
