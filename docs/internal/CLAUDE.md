# CLAUDE.md — TilePier

AI-assistant instructions for this repository. Read before generating or
modifying code. Detailed specs live in `docs/internal/` (docs 01–23);
this file is the operational summary.

## What this is

TilePier — local-first widget dashboard web app. SvelteKit on Cloudflare
Workers (single deployment: static assets + `/api/*` cache proxy).
GPL-3.0-only. Bilingual EN/VI. No accounts, no telemetry, no cookies.

## Stack (do not substitute)

Node 24 LTS · pnpm 11 · SvelteKit ≥2.69.3 (adapter-cloudflare) · Svelte 5
**runes only** · TypeScript 6 strict · Vite 8 (Rolldown —
`build.rolldownOptions`) · Tailwind 4.3 (CSS-first `@theme`, no config js)
· gridstack 12.6 · ECharts 6.1 (lazy, tree-shaken imports from
`echarts/core`) · Dexie 4 · Paraglide JS 2 · MapLibre GL 5 + OpenFreeMap ·
music-metadata · marked + DOMPurify · fast-xml-parser 5 · Vitest 4
(browser mode via @vitest/browser-playwright) · Playwright · MSW 2 ·
ESLint 10 flat · Prettier 3 · knip.

## Commands

```
pnpm verify         # clean → lint → knip → test → build → budgets (what CI runs)
pnpm dev            # dev server
pnpm build          # clean + wrangler types + production build
pnpm preview        # build, then wrangler dev against the built worker
pnpm run deploy:prod # build, then wrangler deploy (note: `pnpm deploy` is a
                    #   pnpm builtin and would NOT run this script)
pnpm gen            # regenerate worker-configuration.d.ts from wrangler.jsonc
pnpm clean          # remove build output
pnpm lint           # prettier --check + eslint + svelte-check
pnpm format         # prettier --write
pnpm test           # vitest (node + browser projects)
pnpm test:e2e       # playwright
pnpm knip           # dead code (CI-blocking)
pnpm budgets        # bundle budget gate (after build)
pnpm fonts:sync     # re-copy font subsets from @fontsource, enforces budget
```

Not written yet, each landing with the feature that needs it:
`tokens:audit` (Week 2, doc 20 §1) · `licenses:gen` (Week 8, doc 16 §5) ·
`build:analyze` (on demand, doc 20 §6).

Three ordering rules worth knowing before they cost you an hour:

- **Run `pnpm gen` after any `wrangler.jsonc` edit**, or `wrangler types
  --check` inside `pnpm lint` fails.
- **Lint before build, or clean first.** `svelte-check` walks the workspace
  directory regardless of tsconfig excludes, so leftover `.svelte-kit/cloudflare`
  output produces hundreds of errors in generated code. `pnpm verify` does this
  in the right order.
- **Paraglide output is generated, gitignored, and needed before lint.** The
  Vite plugin emits `src/lib/paraglide/` at dev/build time, but `pnpm lint` runs
  first — so `i18n:compile` runs at the head of `lint` and `test`. Five tools
  need telling about that directory (git, prettier, eslint, knip, and
  `emitTsDeclarations` for svelte-check); change them together or CI goes red
  once per tool.

**knip is CI-blocking on every commit**, so a module that lands with no importer
fails the build. Slice commits vertically — a primitive plus its first consumer
— never layer by layer (doc 20 §5).

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
    `tp.legal.v1` (versioned, migrated) — `core/storage/local.ts` types the key
    off `LOCAL_KEYS` so a fourth one will not compile. Everything else Dexie
    (`src/lib/core/storage/db.ts`). Schema changes = append a new
    `db.version(n)`, never edit shipped versions. Add a migration test.
    Preferences that want their own key (debug flag, coach dismissal) go inside
    `tp.settings.v1` instead.
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
