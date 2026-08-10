# CLAUDE.md — TilePier

AI-assistant instructions for this repository. Read before generating or
modifying code. Detailed specs live in `docs/internal/` (docs 01–23);
this file is the operational summary.

## What this is

TilePier — local-first widget dashboard web app. SvelteKit on Cloudflare
Workers (single deployment: static assets + `/api/*` cache proxy).
GPL-3.0-only. Bilingual EN/VI. No accounts, no telemetry, no cookies.

## Stack (do not substitute)

Node 24 LTS · pnpm 10 · SvelteKit ≥2.69.3 (adapter-cloudflare) · Svelte 5
**runes only** · TypeScript 6 strict · Vite 8 (Rolldown —
`build.rolldownOptions`) · Tailwind 4.3 (CSS-first `@theme`, no config js)
· gridstack 12.6 · ECharts 6.1 (lazy, tree-shaken imports from
`echarts/core`) · Dexie 4 · Paraglide JS 2 · MapLibre GL 5 + OpenFreeMap ·
music-metadata · marked + DOMPurify · Vitest 3 · Playwright · MSW 2 ·
ESLint 9 flat · Prettier 3 · knip.

## Commands

```
pnpm dev            # dev server (platform-proxy provides KV locally)
pnpm build          # production build (adapter-cloudflare)
pnpm preview        # wrangler-based preview
pnpm test           # vitest
pnpm test:e2e       # playwright
pnpm lint           # eslint + prettier --check + svelte-check
pnpm knip           # dead code (CI-blocking)
pnpm i18n:check     # en/vi key parity (CI-blocking)
pnpm i18n:audit     # hardcoded-string scan in .svelte markup (doc 14 §2)
pnpm tokens:audit   # raw-hex-in-component scan (doc 20 §1)
pnpm budgets        # bundle budget gate (after build)
pnpm build:analyze  # rolldown stats → treemap, on demand (doc 20 §6)
pnpm licenses:gen   # regenerate /legal/licenses register (doc 16 §5)
```

## Hard rules

1. **gridstack owns `.grid-stack-item` wrappers; Svelte owns item content.**
   Never render grid items with `{#each}`. Add/remove via `grid.addWidget`
   / `grid.removeWidget`; mount content with Svelte 5 `mount()`/`unmount()`
   (see `src/lib/core/grid/`). Docs 06 §5.
2. **No direct external fetches from the browser** except
   `tiles.openfreemap.org`. Everything else goes through `/api/*`
   (keys, cache, normalization). CSP enforces this — don't fight it.
3. **No CDN anything.** No `<script src>` third parties, no Google Fonts,
   no unpkg/jsdelivr. Self-host or bundle.
4. **API keys** (`FINNHUB_KEY`, `TWELVEDATA_KEY`) exist only in the Worker
   env. Never import them into client-reachable code paths.
5. **Finnhub free tier has no stock candles** (403). Series come from
   Twelve Data (budgeted, 800/day) with Stooq EOD fallback. Don't
   "simplify" this split.
6. **Runes only.** No legacy `$:` reactivity, no `export let`. Props via
   `$props()`. Effects never fetch — data flows through `swr()` +
   `service.ts`.
7. **`{@html}` requires DOMPurify** + a `// SAFETY:` comment. RSS
   sanitizer allows no `img`. Metadata strings (ID3, geocode names) are
   text nodes, period.
8. **i18n:** every user-visible string is a Paraglide message
   (`m.something()`), added to BOTH `messages/en.json` and
   `messages/vi.json` in the same change. No concatenated sentences —
   parameterized messages only.
9. **Numbers the user watches are JetBrains Mono + `tnum`.** Colors come
   from `@theme` tokens — no raw hex in components.
10. **Storage:** localStorage only for `tp.layout.v1` / `tp.settings.v1` /
    `tp.legal.v1` (versioned, migrated); everything else Dexie
    (`src/lib/core/storage/db.ts`). Schema changes = append a new
    `db.version(n)`, never edit shipped versions. Add a migration test.
11. **Cache TTLs and quota tiers** are constants in
    `src/lib/shared-constants.ts` and must match doc 11 §4 (a test asserts
    this). Change both together.
12. **Widgets are self-contained** in `src/lib/widgets/<id>/` (manifest,
    Widget, Detail, service, types). No cross-widget imports. Manifests
    import nothing heavy — components load via `() => import()` thunks.
13. Every widget implements all states: loading / ready / empty / stale /
    stale-error / offline / error / permission-needed. Tiles never render
    a spinner or a blank.
14. Conventional Commits with widget/area scope. PRs touching `core/` or
    `routes/api/` must pass full CI.

## Layout of interest

```
src/lib/core/        grid, registry, scheduler, swr, storage, log-buffer
src/lib/widgets/     15 widget folders (see docs 07–09 for specs)
src/lib/charts/      echarts init + token-theme bridge
src/lib/lunar/       Vietnamese lunar calendar (Hồ Ngọc Đức port) — has
                     golden test vectors; do not alter math without them
src/routes/api/      Worker endpoints + _lib pipeline (cache/limit/breaker)
docs/internal/       full documentation suite (source of truth)
```

## When unsure

Prefer the documented decision over a "better" idea; if a change
contradicts docs 01–23, update the doc in the same PR or don't make the
change. Bundle budgets (doc 20 §6) and the security headers (doc 15 §2)
are gates, not suggestions.
