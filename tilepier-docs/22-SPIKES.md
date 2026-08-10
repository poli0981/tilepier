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

## S5 · vite-plugin-pwa × adapter-cloudflare — 0.5 day

- **Build:** add plugin, precache shell, offline fallback route, deploy to
  a preview Worker; test offline navigation + update-toast flow.
- **Pass:** `/offline` served when offline; hashed assets cache-first;
  `/api/*` bypassed; new deploy → waiting SW → toast → reload activates.
- **Fail → fallback:** hand-rolled ~80-line SW (doc 17 §2) — spike
  includes writing its skeleton so the fallback is proven, not
  theoretical.

## Exit review

Half-day: update docs 06/09/11/17/20 with findings, adjust Week 1 backlog,
delete spike branches (learnings live here, not in code).
