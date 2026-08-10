# 01 · Project Charter

## Vision

TilePier is a calm, personal command deck in a browser tab: a grid of small,
beautiful widgets that each open into a full instrument view. It is local-first,
account-free, ad-free, and tracking-free. The user owns every byte: layout,
notes, playlists, and files never leave the device except through the thin
caching proxy that fetches public data.

One sentence: **"Your new-tab page, if it were built like an instrument panel."**

## Goals (v1.0)

1. 15 widgets shipping with both a compact grid view and a full detail view
   (docs 07–09), each meeting the widget Definition of Done (doc 19).
2. Free-form layout: drag, resize, add, remove; layout survives reloads and is
   exportable/importable as JSON (doc 05).
3. Fully bilingual EN/VI, Vietnamese-first typography, lunar calendar support.
4. Works offline: cached data shown with stale badges; app shell precached.
5. Total infra cost ≈ $0/month on the existing Cloudflare account by aggressive
   edge caching of free-tier APIs (docs 10–11).
6. Public GPL-3.0 repo with reproducible builds, CI, and a bug-report flow that
   attaches console logs to a structured issue template.

## Non-goals (v1.0)

- No accounts, no sync between devices (export/import JSON is the bridge).
- No server-side user data. The proxy stores only anonymous cached API payloads.
- No VN-exchange equities (unofficial APIs only; revisit v1.x behind a flag).
- No widget marketplace / third-party widget plugins (architecture must not
  preclude it — the registry is data-driven — but no public plugin API in v1).
- No mobile-native apps. Responsive web + PWA install is the mobile story.
- No AI features.

## Positioning

- **Standalone product.** Shares no branding, tokens, or roadmap with OmniDeck
  (the WPF super-app). Conceptual overlap is acknowledged and intentional;
  the products serve different environments (native Windows vs any browser).
- Differentiators vs generic "startpage" dashboards: Vietnamese lunar calendar
  as a first-class feature, instrument-panel design language ("Đài quan trắc",
  doc 12), local music library, honest offline behavior, GPL and self-hostable
  (`pnpm build && wrangler deploy` on any Cloudflare account).

## Target users

1. Primary: the developer's own daily use (dogfooding is the v1 QA plan).
2. Vietnamese-speaking users wanting lunar dates + VND currency in a dashboard.
3. Privacy-minded users who want a startpage without accounts or telemetry.

## Success criteria for v1.0 launch

- All 15 widgets pass DoD; zero P0/P1 open bugs at tag time.
- Initial route ≤ 200 KB gzipped JS; each detail chunk ≤ 350 KB (doc 20).
- Lighthouse (desktop): Performance ≥ 90, A11y ≥ 95, Best Practices ≥ 95.
- Cold load → first widget rendered from cache < 1.5 s on mid-range hardware.
- Proxy stays inside free-tier quotas at 500 DAU in the load model (doc 11 §7).
- Legal gate, licenses page, and attributions verified against doc 16.

## Risks (top 5) and mitigations

| # | Risk | Impact | Mitigation |
|---|------|--------|-----------|
| 1 | gridstack ↔ Svelte 5 DOM-ownership conflicts | Rework of core shell | Spike S1 before Week 1; imperative registry-driven mounting (doc 06 §5) |
| 2 | Music: FSA handle persistence UX / non-Chromium fallback | Week 7 slip | Spike S2; fallback path (blob import) is the guaranteed baseline; visualizer is cut-line |
| 3 | Free API quota exhaustion (Twelve Data 800/day) | Broken stock charts | KV cache + circuit breaker + stale-serve (doc 11 §5–6); Stooq EOD fallback |
| 4 | Bundle bloat (ECharts + MapLibre) | Perf budget miss | Per-widget lazy chunks, budget CI check (doc 20 §6), Spike S4 |
| 5 | vite-plugin-pwa ↔ adapter-cloudflare friction | Offline story broken | Spike S5; fallback = hand-rolled minimal SW |

## Out-of-band decisions log

Keep future decisions appended here with date + one-line rationale, so the
suite stays the single source of truth.

- 2026-07-19 · Toolbox widget merges QR/password/color into one widget → grid
  stays uncluttered; each tool too small to justify a tile.
- 2026-07-19 · Currency history built by self-accumulated daily KV snapshots
  (no free API provides VND history) — doc 10 §3.
- 2026-08-10 · This suite lives at `docs/internal/` and is committed publicly,
  not gitignored → portfolio value outweighs the mild exposure of internal
  scheduling notes; the suite README's open question is now closed.
- 2026-08-10 · Week 0 runs as **bootstrap-then-spike**: the real repo is
  scaffolded once and S1/S4/S5 run inside it on `spike/*` branches (S2/S3 stay
  isolated) → S4 and S5 are unmeasurable without the real dependency set, so
  doc 22's throwaway-branch framing would mean scaffolding three times. The
  doc 22 gate itself is unchanged.
- 2026-08-10 · Primary domain changed from the subdomain `tilepier.poli0981.dev`
  to the apex domain **`tilepier.win`** → TilePier gets its own Cloudflare zone
  instead of sharing the personal site's. Two consequences worth keeping:
  the free-plan "1 rate-limit rule" budget (doc 11 §7) is now TilePier's alone
  rather than competing with poli0981.dev, and there is no longer any risk of a
  deploy colliding with the personal site's routes. Nominatim's mandatory
  User-Agent (doc 10 §6) and the wrangler custom-domain binding (doc 21 §4)
  both follow the new host.
- 2026-08-10 · pnpm raised 10.x → 11.x (doc 02) → 11.15.1 is the installed
  toolchain and nothing in v1 depends on 10.x behaviour. TypeScript stays on
  6.0.x and gridstack on 12.6.x despite 7.0.2 / 13.0.2 shipping — each gets its
  own PR, and gridstack's is gated on Spike S1 passing first (doc 02 note 7).
- 2026-08-10 · CI workflows are authored locally in `.github/workflows/` and
  extracted to `poli0981/.github` later → the seven `wf-*.yml` reusable
  workflows doc 21 §1 calls **do not exist** in that org repo (verified
  2026-08-10); blocking Week 1 on writing them there first was the worse
  trade. Doc 21 §1 carries the deviation note.
