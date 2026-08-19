# 03 · Architecture

## System overview

```
┌────────────────────────── Browser ──────────────────────────┐
│  SvelteKit app (SPA-ish, SSR only for shell + legal pages)  │
│                                                             │
│  Dashboard shell ── gridstack 12 (imperative DOM)           │
│    └─ TpWidgetHost per tile ── mounts widget component      │
│  Widget Registry (manifests, lazy import)                   │
│  Central Scheduler (one ticker, per-widget cadence)         │
│  Data layer per widget (service.ts) ── SWR                  │
│  Storage: localStorage │ Dexie/IndexedDB │ FSA handles      │
│  Service Worker: precache shell, offline fallback           │
└───────────────┬─────────────────────────────┬───────────────┘
                │ /api/* (same origin)        │ tiles only
                ▼                             ▼
┌── Cloudflare Worker (same deployment) ──┐  OpenFreeMap tiles
│ SvelteKit server endpoints              │  (direct, cached by
│  · normalize + hide API keys            │   browser + CF CDN)
│  · KV cache (TILEPIER_CACHE)            │
│  · soft rate limit + circuit breaker    │
└───────┬─────────────────────────────────┘
        ▼
External APIs: Open-Meteo · open.er-api.com · Binance · Finnhub
· Twelve Data · Photon/Nominatim · arbitrary RSS feeds (guarded)
```

Key properties:

- **One deployment.** The SvelteKit build (adapter-cloudflare) produces a single
  Worker serving both static assets and `/api/*`. No separate proxy repo.
- **Local-first.** All user data is client-side. The Worker is stateless except
  for the anonymous KV cache.
- **Every network call except map tiles goes through `/api/*`.** This is what
  makes CSP tight (doc 15), keys hidden, and quotas survivable (doc 11).

## Rendering strategy

- `/` (dashboard): prerendered shell, **not** `ssr = false`. Corrected
  2026-08-10 — the original wording asked for both, and they are incompatible:
  `ssr = false` disables server rendering for the layouts above the page too,
  so the legal gate disappears from the HTML. Verified on a real build, where
  `/` came back with no gate markup while `/legal/*` carried it — exactly
  backwards from doc 16 §2.
  The stated reason for `ssr = false` (SSR "would render an empty shell then
  flash") is handled where it belongs: the deck renders nothing until it has
  mounted and read client storage, so the server emits an empty deck area and
  there is nothing to flash. Header, theme class, and gate still prerender.
- Route groups carry the gate boundary: `(app)/` wraps the deck and owns the
  gate; `/legal/*` sits outside it, because a visitor must be able to read the
  texts the gate links to before agreeing to them.
- Pre-paint work (gate check, theme, locale) lives in `static/boot.js`, loaded
  synchronously from `<head>`. It cannot be an inline `<script>`: CSP is
  `script-src 'self'` with no `'unsafe-inline'` (doc 15 §2). Reference it by
  absolute path — `%sveltekit.assets%` emits a relative URL that breaks on
  nested routes.
- `/w/[id]` (detail deep link): client-rendered; opening from the grid is a
  FLIP expansion, direct navigation renders detail standalone (doc 13 §5).
- `/legal/*`, `/about`: prerendered static pages (SEO + loads before JS).
- `/api/*`: server endpoints only, `export const prerender = false`.

## Repo structure

```
tilepier/
├─ src/
│  ├─ lib/
│  │  ├─ core/
│  │  │  ├─ registry.ts          # widget manifests index (doc 06)
│  │  │  ├─ types.ts             # TpWidgetId / TpWidgetCategory unions
│  │  │  ├─ ids.ts               # instanceId + short hash (doc 05 §2)
│  │  │  ├─ scheduler.ts         # central ticker (doc 04 §3)
│  │  │  ├─ swr.svelte.ts        # stale-while-revalidate helper (doc 04 §2)
│  │  │  ├─ storage/
│  │  │  │  ├─ local.ts          # typed localStorage access + migrations
│  │  │  │  ├─ db.ts             # Dexie schema (doc 05)
│  │  │  │  └─ exporter.ts       # settings/layout export-import
│  │  │  ├─ grid/
│  │  │  │  ├─ TpGrid.svelte     # gridstack lifecycle owner
│  │  │  │  └─ TpWidgetHost.svelte
│  │  │  └─ log-buffer.ts        # console ring buffer (doc 18)
│  │  ├─ widgets/
│  │  │  └─ <id>/                # one folder per widget
│  │  │     ├─ manifest.ts
│  │  │     ├─ Tp<Name>Widget.svelte
│  │  │     ├─ Tp<Name>Detail.svelte
│  │  │     ├─ service.ts        # fetch/transform/cache (optional)
│  │  │     └─ types.ts
│  │  ├─ ui/                     # shared Tp components (TpButton, TpBadge …)
│  │  ├─ charts/                 # echarts setup: core init, theme bridge
│  │  ├─ lunar/                  # Hồ Ngọc Đức algorithm (ported from QuoteAtlas)
│  │  ├─ i18n/                   # paraglide output + helpers
│  │  └─ stores/                 # app-level runes stores (settings, theme, online)
│  ├─ routes/
│  │  ├─ +layout.svelte / +layout.ts
│  │  ├─ +error.svelte           # 404/500 (doc 17) — outside (app), renders pre-gate
│  │  ├─ (app)/                  # gate boundary: deck + settings
│  │  │  ├─ +layout.svelte       # legal gate (doc 16 §2)
│  │  │  ├─ +page.svelte         # dashboard
│  │  │  └─ settings/+page.svelte # doc 13 §10
│  │  ├─ w/[id]/+page.svelte     # detail deep link
│  │  ├─ legal/{terms,privacy,licenses}/+page.svelte
│  │  ├─ about/+page.svelte      # doc 13 §11
│  │  ├─ offline/+page.svelte    # SW fallback target
│  │  └─ api/                    # server endpoints (doc 11)
│  │     ├─ weather/+server.ts
│  │     ├─ fx/+server.ts
│  │     ├─ crypto/[...path]/+server.ts
│  │     ├─ stock/{quote,series}/+server.ts
│  │     ├─ rss/+server.ts
│  │     ├─ geocode/+server.ts
│  │     └─ _lib/ (kv-cache.ts, ratelimit.ts, upstream.ts, respond.ts)
│  ├─ hooks.server.ts            # security headers, error shaping
│  └─ service-worker.ts          # if S5 forces hand-rolled SW
├─ e2e/                          # Playwright
├─ static/                       # fonts (self-hosted), icons, manifest
├─ docs/internal/                # this suite (gitignored — decide at init)
├─ .github/workflows/            # caller stubs (doc 21)
├─ wrangler.toml                 # Worker name, KV binding, custom domain
├─ eslint.config.js · knip.json · .prettierrc · renovate.json
└─ package.json · pnpm-lock.yaml · svelte.config.js · vite.config.ts
```

## Module boundaries (enforced by convention + knip)

1. `widgets/*` may import from `core`, `ui`, `charts`, `i18n`, `lunar` —
   never from another widget's folder. Cross-widget reuse graduates into
   `core` or `ui` first.
2. `routes/api/*` never imports from `widgets/*` (server code must not pull
   component graphs). Shared request/response types live in
   `src/lib/api-types.ts`, imported by both sides.
3. `core` imports nothing from `widgets` except the static manifest index in
   `registry.ts` (which references only `manifest.ts` files — manifests must
   not import components eagerly; they expose `() => import(...)` thunks).

## Environment & bindings

| Name | Kind | Purpose |
|------|------|---------|
| `TILEPIER_CACHE` | KV namespace | Edge cache + fx snapshots + soft rate-limit counters |
| `FINNHUB_KEY` | secret | Stock quotes |
| `TWELVEDATA_KEY` | secret | Stock series |
| `TP_BUILD` | build-time define | version + short SHA injected via Vite `define` |

Local dev: `wrangler dev`-compatible via `pnpm dev` with `platform-proxy`
(adapter-cloudflare's `getPlatformProxy`) so KV works locally against a
preview namespace. `.dev.vars` holds dev keys (gitignored).
