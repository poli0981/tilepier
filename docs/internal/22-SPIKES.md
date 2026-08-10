# 22 · P0 Spikes (Week 0 — before any feature work)

Each spike: timeboxed, throwaway branch `spike/s<N>-…`, findings appended
to this file (date + verdict + notes). A red spike triggers its listed
fallback, not schedule denial.

## S1 · gridstack 12 × Svelte 5 DOM ownership — 1.5 days

- **Build:** minimal page — TpGrid managing 6 dummy widgets via the doc 06
  §5 contract (imperative addWidget + `mount()`/`unmount()`, change-event
  serialization, batch rebuild from JSON, responsive column collapse).
- **Pass:** 50 scripted cycles of add/drag/resize/remove/rebuild →
  DevTools Memory shows no detached-node growth; no Svelte
  `effect_orphan`/`state_unsafe_mutation` warnings; layout JSON stable
  round-trip; column collapse and restore don't duplicate hosts.
- **Fail modes → fallback:** if gridstack mutates content nodes it
  shouldn't, isolate widget content behind one extra wrapper div it never
  touches; if unrecoverable (unlikely), fallback candidate list:
  svelte-grid-extended / hand-rolled CSS-grid drag (cost: ~1 wk, decide
  only on hard evidence).

### Findings — 2026-08-10 · **GREEN**, no fallback needed

Harness at `src/routes/spike/s1/`, measurements in `e2e/s1-grid.e2e.ts`
(6 assertions, all passing). The DevTools-Memory criterion was replaced with
something a build can enforce: count `.grid-stack-item` wrappers, mounted
Svelte hosts, and serialised tiles after every batch and require all three to
agree. A host outliving its wrapper is a detached Svelte tree; a wrapper
outliving its host is a detached DOM node. The 50 cycles are net-neutral
(+2 added, rebuild restores one, 2 removed), so "the counts never move" is a
real invariant rather than a restatement of the script.

The contract in doc 06 §5 was **correct but incomplete**. Two rules had to be
added, both found by the harness, both silent in production:

1. **The grid-setup effect must untrack its body.** Mounting a host reads the
   `widgets` and callback props, and callback props are fresh function
   identities on every parent render. Tracked, that makes the setup effect
   depend on them: mount a host → notify the parent → parent re-renders → new
   identity → effect re-runs → destroy and rebuild the whole grid → mount a
   host → … The page locked hard enough that Playwright could not read `body`.

2. **`removeAll()` must not be called inside `batchUpdate()`.** gridstack 12.6
   defers DOM work while batching, and a batched `removeAll(true, …)` detaches
   nodes from the grid model but leaves every `.grid-stack-item` in the
   document. Measured growth across three rebuilds: 7 → 15 → 25 → 37 wrappers
   while hosts and tiles stayed correct. Nothing throws and nothing warns.
   Teardown now runs outside the batch; only additions are batched.

Two smaller notes for whoever writes the real grid:

- gridstack only adds a class for the **disabled** state
  (`ui-draggable-disabled` / `ui-resizable-disabled`); there is no marker class
  when interaction is enabled. Assert absence, or better, assert inertness by
  attempting a drag and checking the layout did not move.
- `exactOptionalPropertyTypes` (doc 20 §2) means optional callback props need
  an explicit `| undefined` in their type, or passing one through fails to
  compile.

Layout JSON round-trips byte-stable, column collapse 1440 → 420 → 1440 keeps
exactly one host per wrapper at every breakpoint, and view mode is genuinely
inert — a real drag leaves the serialised layout unchanged.

**Consequence for doc 02:** the gridstack 13.0.2 bump stays blocked on re-running
this harness, which is now a cheap and meaningful acceptance test rather than a
manual inspection.

## S2 · File System Access persistence + fallback — 1 day

- **Build:** pick folder → persist handle in Dexie → reload →
  `queryPermission` → re-link gesture → walk 200-file tree → parse tags in
  a Worker (music-metadata) → list render. Plus blob-import path on
  Firefox.
- **Pass:** Chromium: handle survives restart; permission re-grant is one
  click; 200 files scanned < 10 s with UI responsive. Firefox: import 50
  files → quota estimate visible → playback OK.
- **Watch:** memory during tag parse (stream, don't load whole files —
  music-metadata supports ranged reads via Blob), cover-art dedupe cost.
- **Fail → fallback:** if handle persistence is flaky, demote FSA to
  "session mode" + make blob-import primary everywhere (UX cost noted in
  doc 09).

## S3 · API quota & cache reality check — 1 day

- **Build:** deploy a scratch Worker with the doc 11 pipeline for
  `stock/series` + `crypto/klines` + `weather`; script simulating 50
  virtual users × 8 h (visibility-aware polling per doc 04) against it.
- **Pass:** measured Twelve Data consumption ≤ model (doc 11 §5) with
  ≥ 85 % KV hit rate; breaker + budget tiers trip correctly when forced
  (inject 429s); `api-credits-left` parsing verified against real
  responses; Finnhub 403-on-candle confirmed once (documented proof) and
  the split routing works.
- **Fail → fallback:** raise TTLs per table until model closes; if
  intraday still tight, 1D range ships crypto-only and stocks start at 1W
  (Stooq daily).

## S4 · Bundle budget on Vite 8 / Rolldown — 0.5 day

- **Build:** scaffold app with echarts (tree-shaken core+candlestick+line+
  bar+dataZoom+tooltip+grid), maplibre, gridstack, dexie, paraglide wired
  as real lazy chunks; run `build` + budgets script.
- **Pass:** entry ≤ 200 KB gz; echarts shared lazy chunk ≤ 330 KB gz;
  maplibre ≤ 300 KB gz; chunk naming stable for `rolldownOptions`
  configuration (doc 20 §6 table achievable).
- **Fail → fallback:** echarts over budget → drop dataZoom on weather
  (keep on markets), or split candlestick-only build for markets;
  maplibre over → accept 340 KB with a doc note (map is opt-in interaction)
  — budgets are guardrails, adjust consciously in one place.

### Findings — 2026-08-10 · **GREEN**, no fallback needed

Harness at `src/routes/spike/s4/` pulls each heavy library through a real
`() => import()` thunk behind a button, mirroring the manifest contract in
doc 06 §1. Measuring a statically-imported bundle would have said nothing about
the shape the product ships.

| Budget | Measured (gz) | Limit | Headroom |
|---|---|---|---|
| Entry | 1.7 KB | 200 KB | 99 % |
| CSS total | 6.2 KB | 45 KB | 86 % |
| Fonts (raw) | 148.4 KB | 220 KB | 33 % |
| echarts shared chunk | **183.4 KB** | 330 KB | 44 % |
| maplibre chunk | **263.8 KB** | 300 KB | **12 %** |

echarts came in far under budget with the tree-shaken import set
(core + line + bar + candlestick + grid + tooltip + dataZoom + canvas renderer),
so neither documented fallback is needed — dataZoom stays on weather.

**maplibre has only 12 % headroom.** It is one library at one version with no
tree-shaking to give, so treat 300 KB as effectively fixed: a maplibre major
bump is the realistic way this row goes red, and doc 22's "accept 340 KB with a
doc note" is the answer if it does. Entry is at 1 % because the deck is still a
placeholder — that number means nothing until Week 1 lands the real shell.

**The chunk-naming criterion was wrong, and so was the first budget script.**
Doc 22 asked for "chunk naming stable for `rolldownOptions` configuration".
SvelteKit owns `output.chunkFileNames` for the client build and overrides a
user-supplied one; the emitted names are pure content hashes. The
`build.rolldownOptions` block written for this was silently ineffective and has
been removed rather than left as decoration.

The fix is that filenames were never the right handle. `scripts/check-budgets.mjs`
now identifies chunks by the **source module** that produced them, read from
`.svelte-kit/output/client/.vite/manifest.json` — which is what doc 20 §6 said
all along ("reading the Rolldown manifest"). The first implementation matched
filenames and reported four rows as "no matching chunk" while the chunks were
sitting right there: a budget report that says PASS while measuring nothing is
worse than no budget at all.

Non-optional rows now fail when they match nothing, so a moved module cannot
quietly disable its own budget.

`e2e/s4-budgets.e2e.ts` guards the part sizes cannot: nothing over 60 KB is
fetched before any interaction, and each library arrives only when its code
runs. A static `import 'echarts'` added to a widget would break doc 06 §1
without moving a single budget number — this is what catches that.

## S5 · vite-plugin-pwa × adapter-cloudflare — 0.5 day

- **Build:** add plugin, precache shell, offline fallback route, deploy to
  a preview Worker; test offline navigation + update-toast flow.
- **Pass:** `/offline` served when offline; hashed assets cache-first;
  `/api/*` bypassed; new deploy → waiting SW → toast → reload activates.
- **Fail → fallback:** hand-rolled ~80-line SW (doc 17 §2) — spike
  includes writing its skeleton so the fallback is proven, not
  theoretical.

### Findings — 2026-08-10 · **GREEN via the fallback**

vite-plugin-pwa was tried first and abandoned inside the half-day box. The
hand-rolled worker (`src/service-worker.ts`, ~110 lines) ships instead, and all
four pass criteria hold — verified by `e2e/s5-pwa.e2e.ts`, 8 assertions against
a real workerd runtime: `/offline` served for an unvisited route while offline,
a precached page still rendering after `setOffline(true)`, no `/api/` URL in
any cache, hashed immutable assets cached, and `skipWaiting` reachable only
through the SKIP_WAITING message.

**Why the plugin lost.** Two problems, in order:

1. `@vite-pwa/sveltekit` builds its precache manifest from SvelteKit's internal
   output layout — `client/…` and `prerendered/pages/…` — which adapter-static
   preserves and **adapter-cloudflare flattens into the deployment root**. All
   46 entries 404'd, the install step failed, and
   `navigator.serviceWorker.ready` simply hung: nothing thrown, nothing logged.
   A `manifestTransforms` URL rewrite fixed it, and is worth knowing about for
   anyone who retries this.
2. With URLs corrected the worker installed and activated, but its Workbox
   module never ran. Inspected from inside the worker: `caches` empty, `define`
   shim present, so the AMD `importScripts` of the workbox runtime never
   registered its module. Not resolved in the box.

**Why the fallback is arguably the better answer here.** `$service-worker`
hands SvelteKit's own `build` / `files` / `prerendered` arrays — the URLs it
*actually serves*. That removes the entire class of path-translation bugs above,
drops a second runtime from the SW, and the whole thing is 3 KB (1.1 KB gz)
against Workbox's 15 KB runtime. doc 17 §2 asks for exactly three behaviours;
none of them needed a framework.

**Precache is the app shell only,** as doc 17 §2 says. Left to defaults the
plugin precached 2021 KiB across 46 entries — 1.5 MB of it the maplibre
(1004 KB) and echarts (548 KB) chunks that every visitor would pay before ever
opening a map or a chart. The hand-rolled worker precaches `build + files +
prerendered` and lets the heavy lazy chunks fall to its cache-first rule, so
they cache on first real use.

**Test-rig notes, both of which cost real time:**

- Service workers need a secure context, and `wrangler dev --local-protocol
  https` uses a self-signed certificate. Playwright's `ignoreHTTPSErrors`
  covers page and API requests but **not** the fetch of a service-worker
  script — Chromium enforces certificate validity there regardless and fails
  registration with "An SSL certificate error occurred when fetching the
  script". The browser flag `--ignore-certificate-errors` is the only way
  through locally.
- `page.waitForFunction` with an **async** predicate evaluates to a Promise,
  which is always truthy, so the wait returns instantly and the next assertion
  runs against a worker that has not registered. Use `expect.poll`.

## Exit review

Half-day: update docs 06/09/11/17/20 with findings, adjust Week 1 backlog,
delete spike branches (learnings live here, not in code).
