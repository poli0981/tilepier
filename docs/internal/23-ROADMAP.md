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

## Week 2 — Tier 1, batch 1 · **COMPLETE 2026-08-27, M2 met**
~~clock detail (world clock; the tile shipped in Week 1) · timer
(+focusSessions) · calc · notes · todo — tiles + details + states + tests per
DoD · backup export/import (doc 05 §6) + e2e journey #6, now that there is data
to round-trip.~~ **M2:** the deck is already a usable daily tool.

Shipped in seven commits. The roadmap line above assumed infrastructure that
did not exist, and that gap was most of the week: there was **no detail overlay
and no `/w/[id]` route at all**, no `lib/i18n/fmt.ts`, no debounced Dexie
writer, no exporter, no notes sanitiser profile, no `tokens:audit` — and
`ci.yml` ran neither i18n gate despite doc 14 §4 claiming one was CI-blocking
from Week 1. The quality gates landed first, deliberately, so the four widgets
were held to them from their first line.

Numbers at the milestone: 577 unit and component tests (up from 271), 92 e2e
(from 70), 92.0 % lines and 85.4 % branches, entry chunk 2.7 KB gz of a 200 KB
budget, largest tile chunk 1.9 KB of 40 KB, 306 message keys with no drift,
zero hardcoded strings and zero raw hex outside `app.css`.

**Five bugs found by the work rather than by review**, each recorded where it
belongs. `TpGrid` mounted hosts with static props, so doc 06 §2's
`onUpdateSettings` contract was a write to storage the widget never saw — it
had been latent since Week 1 and affected every widget (doc 06 §5 rule 11). The
calculator's `divide` guaranteed decimal *places* and called them significant
digits, losing eight digits converting millimetres to miles (doc 07 §3). The
notes DOMPurify config had `USE_PROFILES` *widening* the allowlist it looked
like it narrowed, and a strict `ALLOWED_URI_REGEXP` silently stripping
`type="checkbox"` (doc 07 §4). And the backup importer held its parsed file in
a `$state`, which deep-proxies — IndexedDB cannot clone a `Proxy`, so every
import failed, silently, until the restore learned to report failure (doc 05
§6). The last three were caught by tests written to the specs' own
requirements: the converter's round-trip sweep, doc 19 §3.6's XSS corpus, and
journey #6.

Two specification contradictions were resolved rather than worked around. Doc
06 §3 required eight tile states of every widget while doc 17 §3 classed
tier-1 widgets "fully functional" offline — the states are now keyed to the
widget's offline class, with per-widget unreachability recorded alongside. And
`w/[id]` moved inside the `(app)` route group: doc 03 drew it outside, which
would have served notes and todo content full-screen before the legal gate.

Merged as `3938fd3` (PR #1, squash — the `main` ruleset allows no other
method) and deployed by Cloudflare Workers Builds the same day. Verified on
production: the deck, all four new widgets, the detail overlay and the backup
round-trip, plus the layout holding to 500 % zoom (doc 19 §5).

One CI failure on the way, worth the line: a component test clicked a
full-viewport scrim at its midpoint, where the centred panel sits. It passed
locally and lost the race on a slower runner. Three call sites now aim at a
corner, and doc 19 §4 says so.

## Week 3 — Tier 1, batch 2 + proxy skeleton · **COMPLETE 2026-08-28, M3 met**
~~calendar + lunar module port w/ test vectors · toolbox · quote ·
`/api/_lib` pipeline (KV cache, limiter, breaker, envelope) + `/api/weather`
+ `/api/geocode` live.~~ **M3:** first networked data flows end-to-end.

**What Week 3 starts from.** Week 2 left four things deliberately unfinished
for it, each with a reason rather than as a slip:

1. **`swr()` is still only specified** (doc 04 §2, written Week 1). It lands
   here with `/api/weather` as its first consumer, because it cannot be tested
   honestly before there is a fetcher and MSW fixtures. `msw` is still on
   knip's `ignoreDependencies` list waiting for exactly that; delete the line
   when it is wired.
2. **`dateKeyOf` exists twice**, in `widgets/timer/service.ts` and
   `widgets/todo/service.ts`, both with a comment saying so. doc 03 §1 moves
   reuse into `core/` when there *is* reuse rather than in anticipation — the
   calendar is the third caller, so it graduates now, and `events` uses the
   same key format (doc 05 §3).
3. **Journeys #3 and #4 are unwritten** because both need networked data. The
   overlay mechanism they lean on is already covered by
   `e2e/detail-expansion`, so #3 only has to add the chart and the fixture.
4. **Diagnostics section 8 is still two rows of four** (doc 13 §10): the swr
   cache ages and breaker states arrive with their modules, here.

Two carried notes that are not Week 3's job but are easy to trip over. The RSS
DOMPurify profile joins `core/sanitize.ts` in Week 6 as a *separate function*,
not a flag on the notes one — the two threat models differ, and a boolean
parameter is one typo away from applying the wrong profile. And
`TpMarkdown.svelte` is the only `{@html}` in the application; keep it that way.

The lunar port is the one piece with no room for interpretation: doc 07 §6
pins it to Asia/Ho_Chi_Minh regardless of viewer zone, and doc 19 §3.1 lists
the vectors it has to satisfy before anything renders.

### Shipped, in nine commits

Three widgets — calendar, toolbox, quote — plus the lunar module, `swr()` and
its envelope client, `/api/geocode`, and the weather payload doc 10 §2 had
required since Week 0 and never had. Eight of fifteen widgets are registered.

**M3 is met with an asterisk that is worth stating rather than glossing.** The
milestone reads "first networked data flows end-to-end", and every piece of that
flow exists and is tested — envelope, cache, status, two live endpoints — but
nothing on the deck consumes it yet, because doc 23 puts the first networked
*widget* in Week 4. That was known at the start of the week and chosen
deliberately: `swr()`'s shipping consumer is doc 13 §10 §8's cache-age table,
and journey #3 moves to Week 4 with the weather detail it describes.

**Numbers at the milestone:** 962 unit and component tests (from 577), 98 e2e
(from 92), 93.8 % lines and 87.2 % branches, entry chunk 3.0 KB gz of 200 KB,
largest tile chunk 1.8 KB of 40 KB, 419 message keys with no drift, zero
hardcoded strings and zero raw hex outside `app.css`.

**Six faults found by the work rather than by review.** Four were latent bugs,
two were specification contradictions:

1. **`TpWidgetHost` registered a scheduler no-op** keyed on `instanceId`, and
   `register()` refcounts with first-registration-wins — so a widget could never
   supply a real `run` for its own id. Latent since Week 1, harmless only
   because no widget had a cadence until this week's two.
2. **`online.init()` was never called anywhere**, so `isOnline` was permanently
   true: the doc 13 §7 offline chip could not appear and doc 04 §3's wake on
   reconnect could not fire. Latent since Week 1, and journey #4 is precisely
   the test that was missing.
3. **Adding a widget not already on the deck mounted an empty tile.** The deck
   page loads components once from the seeded ids. Invisible because journey #2
   adds `clock` — already seeded — and asserts wrapper counts, which were right.
4. **`convertLunar2Solar` answered instead of refusing.** Its leap-month guard
   sits inside the branch for years that *have* a leap month, so leap 1/1 of
   2026 returned ordinary Tết. `solarOfLunar` now verifies by converting back.
5. **doc 13 §8's contrast figures were wrong** — asserted as 11.9 and 5.1,
   measured at 15.35 and 7.16 — and the same sweep found `fg-dim` at 3.51, a
   large-text-only pass used at `--text-2xs` in three widgets.
6. **`/api/weather` was not normalizing anything**, contradicting doc 10 §2
   since Week 0.

Two specification contradictions resolved rather than worked around: `quote` sat
in doc 06 §3 and doc 17 §3's cached-data class while doc 08 §3 said its dataset
is bundled; and `MALFORMED` was "never retried" in doc 04 §2 and "treat as
UPSTREAM_DOWN" in doc 17 §4.

**Deferred out of Week 3, each with a reason rather than a slip.** `/api/_health`
and the diagnostics breaker rows move to Week 5: they need `env.DEV_DASH_TOKEN`,
and typing a secret means `wrangler types` reading a gitignored `.dev.vars`, so
the committed types would differ between a checkout and CI. Week 5 is where doc
23 already puts the quota watch, which is when a breaker table first says
anything. Journey #3 moves to Week 4 with the weather detail. Quote's
share-as-image is **cut**, which doc 08 §3 anticipated by calling it a stretch
and doc 23's slip policy by listing it.

Merged as `676c316` (PR #2, squash — the `main` ruleset allows no other method)
and deployed by Cloudflare Workers Builds the same day. **Verified on
production**: the two endpoints by request, the interface by hand, and a QR of
Vietnamese text scanned with a phone — which is the one check no test in this
repo can make, and `qr.test.ts` says so in as many words. Details in doc 19 §5.

One decision went against the letter of a spec and is recorded in doc 02 and doc
07 §7: the QR encoder is a zero-dependency package rather than a vendored file.
Vendoring was measured first — 990 lines producing 43 errors under
`noUncheckedIndexedAccess`, needing `@ts-nocheck` and four tooling exclusions in
a repo that has none.

## Week 4 — Weather · Currency · **4a COMPLETE 2026-08-30, M4 met; 4b open**
weather widget+detail (ECharts bridge built here, theme-linked) ·
fx endpoint + snapshot mechanism + currency widget/detail (history chart
against accumulating snapshots) · offline/stale polish pass on both.
**M4:** tier-2 pattern (swr + proxy + echarts) proven and documented back.

### The split, and the number behind it

This week was measured before it was started, by eight assessment agents and
three adversarial verifiers over the nine work items below. **21.25 focused
days against a five-day solo week — 4.25×.** Verification removed about 1.5
days of work that rested on false premises and added two findings that were
worse than the plan assumed, so the number did not move in the direction that
would have been convenient.

| | item | complexity | difficulty | days |
|---|---|:--:|:--:|--:|
| A | ECharts bridge | 3 | 4 | 1.5 |
| B | weather tile + service | 4 | 4 | 2.5 |
| C | weather detail | 4 | 4 | 2.5 |
| D | place picker + geolocation | 3 | 4 | 2.0 |
| E | `/api/fx` + snapshots | 3 | 3 | 3.0 |
| F | currency widget + detail | 4 | 4 | 4.0 |
| G | toast host + stale badge | 4 | 4 | 2.5 |
| H | tests, journeys, gates | 4 | 4 | 2.5 |
| I | the tile-gap fix | 3 | 3 | 0.75 |

*Complexity* is breadth — parts, files, contracts crossed. *Difficulty* is
depth — how easy it is to get wrong and not notice. They are scored
independently because they do not travel together: `fx` is broad and
straightforward, the ECharts bridge is narrow and full of silent traps.

Four **depth** cuts were taken rather than cutting widgets, which is the same
move this doc's slip policy made for quote's share-as-image in Week 3: the
currency history chart and `/api/fx/history` (−2.0), the AQI gauge and
astronomy card (−0.8), seven WMO glyphs instead of sixteen (−0.5), and the
stale badge in the widget body rather than a new `core/tile-status` channel
(−0.5, **restored in 4b** — the channel turned out to cost one file and a
`$derived`, because a module import crosses the `mount()` boundary a prop
cannot). That leaves ≈17.5, split as:

- **Week 4a — weather.** Gap fix, tile, place picker, ECharts bridge, detail.
- **Week 4b — currency.** `/api/fx` + snapshots, currency widget and detail,
  the toast host and stale badge, journey #4's second half.

**M4 is met by 4a alone**, and that is what the milestone sentence asks for:
`swr()` has its first consumer, the proxy is exercised end to end, and the
ECharts bridge is built, theme-linked, and back inside the coverage gate.
currency is the pattern's *second* proof and moves without touching M4.

### Week 4a — complete 2026-08-30

Twelve commits, in one PR. Six of them are fixes to things Week 4a only found
because it was the first work to *use* them, which is this codebase's recurring
shape (doc 22 §S1, doc 06 §5 rules 12–14):

- **gridstack's 12 px item margin was never painted.** `margin: 12` was correct
  in the JS options the whole time — `cacheRects`, collision and drop maths all
  assumed it — and one `inset: 0` in `TpGrid.svelte` deleted the gutter. Four
  weeks of green CI; found from a screenshot of touching tiles.
- **`TpGrid.setup()` did not suppress change events**, so gridstack's
  synchronous `change` from inside `addWidget` reported a *prefix* of the deck
  and the store persisted it. A five-tile deck came back from a reload with
  three, permanently.
- **`toGridStackWidget` never emitted the manifests' size bounds**, so every
  tile could be resized to 1×1 regardless of its `sizes.min`.
- **The h=1 header rule** doc 13 §3 always described was half-implemented, and
  once implemented it needed a reserve for the controls it floats over.
- **`journey-6` raced the reload it was waiting behind** — roughly one full
  run in four.
- **The air-quality upstream had no `timezone` parameter at all**, so its
  "current" reading was wrong by the whole offset (doc 10 §2).

Numbers at the end of 4a: nine of fifteen widgets registered, 1083
unit/component tests, 107 e2e, 461 message keys, budgets 7/7 with the shared
echarts chunk at 183.0 KB gz and the largest detail chunk at 4.2 KB.

**What Week 4 starts from.** Week 3 left five things for it, each deliberately:

1. **`swr()` exists and nothing consumes it.** `core/api.ts` and
   `core/swr.svelte.ts` are complete and tested, and the weather tile is their
   first real caller — which is what actually meets M3's "end-to-end", a week
   late by design. The data key is `cacheKey.weather(geohash5)`, already in
   `shared-constants.ts`; the scheduler id is that key rather than the
   `instanceId`, so two tiles on one place fetch once (doc 04 §3).
2. **`/api/weather` returns a real `TpWeatherPayload`.** 48 hourly rows and 7
   daily, camelCase, AQI bundled, attribution inside. `NaN` marks a gap that
   upstream did not send — the chart has to skip those rather than plot zero.
3. **The rate-limit toast has a coordinator and no component.** `swr` already
   throttles to one notice per `BACKOFF.toastThrottleMs`; doc 13 §7 describes
   the toast itself (bottom-centre, one at a time, 4 s), and weather is the
   first widget that can trigger one. `stores/ui.svelte.ts` has no toast state
   yet.
4. **Journeys #3 and #4's second half.** #3 is the weather detail with its
   chart, and doc 19 §4 notes the overlay handshake it leans on is already
   covered by `e2e/detail-expansion`, so #3 only has to add the chart and the
   fixture. #4's offline half is written; the stale badges belong to the weather
   tile. `src/lib/core/__fixtures__/weather.ts` is the recorded envelope, and
   MSW is wired for the node project.
5. **`lib/charts/` is Week 0 spike code with no consumer** and is excluded from
   coverage on that basis (doc 19 §2). It re-enters here, and the exclusion
   should come off with it.

The seeded deck reaches five tiles this week, when `weather` stops being
filtered out (doc 13 §9) — `e2e/_lib/seed.ts` holds that number in one place
now, and it has to move with the registry.

Two carried notes that are not Week 4's job. `fg-dim` measures 3.51:1 and tile
controls sit below the 40 px target (doc 13 §8), and widget chunks are not
precached so a first detail open offline fails (doc 17 §2) — all three are Week
8, all three are written down so that pass starts from a list rather than a
discovery.

**What 4a leaves for whoever picks this up.** Three of them are decisions
rather than tasks, and two are about code that is already live:

1. ~~**`ratelimit.ts:73` writes one KV entry per `/api/*` request**, which on
   the free KV tier exceeds the 1 000 writes/day allowance at roughly a
   thousand API requests.~~ **Resolved 2026-08-30: the account is on Workers
   Paid**, recorded in `wrangler.jsonc` and doc 11 §7. The write is a metered
   cost rather than a ceiling, and doc 10 §3's permanent daily fx snapshot is
   unblocked — so Week 4b's `/api/fx/history` needs no free-tier budget
   rationale for its `days` allowlist. Left visible rather than deleted,
   because the limiter is still the app's highest-volume write and the note
   says what to do if it ever shows up on a bill.
2. **The scheduler's backoff is unreachable.** `execute`'s `finally` always
   recomputes `nextDueAt` from the cadence, and `effectiveDue` is
   `max(nextDueAt, backoffUntil)`, so for weather's 600 s cadence every backoff
   below `BACKOFF.maxMs` (300 s) never fires. Docs 04 §2, 11 §7.3 and 17 §5 all
   describe behaviour no code has. Settle it with the markets tile, which is
   the first widget whose cadence is short enough for it to matter.
3. **An injected resize does not reliably produce a gridstack `change`** — two
   runs in eight ended with the clamped size on screen and no `onLayoutChange`
   beyond the mount emit. If a real pointer can lose one the same way, a
   reader's resize silently fails to persist. Recorded in doc 19 §4; it needs
   an investigation, not a test tweak.
4. **`useRefresh` returns `void`**, so no widget holds a `TpTaskHandle` and
   doc 04 §2's `handle.backoff(...)` cannot be called. Decide the signature
   before a second networked widget is built around the current one.
5. **doc 12 §2a claims `--spacing`, `--tp-bar-h` and `--tp-page-pad` are
   declared in `@theme`.** They are not, and every consumer uses a hardcoded
   fallback — which is why the top bar sits on a 16 px rail while `main`
   overrides to 24 px at ≥768 px. Its own small change, deliberately not folded
   into the gap fix.

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
