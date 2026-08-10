# 20 · Code Quality & Conventions

## 1. Naming

- Components: `Tp` prefix — `TpGrid`, `TpWidgetHost`, `TpClockWidget`,
  `TpClockDetail`, shared UI `TpButton`, `TpBadge`, `TpTideGauge`.
- Files: components PascalCase `.svelte`; modules kebab-case `.ts`;
  one component per file.
- Types/interfaces: `TpWeatherPayload`, `TpWidgetManifest` — `Tp` prefix on
  exported/public types, plain names for file-local types.
- CSS: Tailwind utilities first; the few bespoke classes use `tp-` prefix
  (`.tp-drag`); design tokens only via `@theme` variables — raw hex in
  components is lint-flagged by a grep script (`pnpm tokens:audit`).
- Widget ids: lowercase singular (`clock`, `markets`) — they appear in
  URLs, chunk names, i18n keys.

## 2. TypeScript rules

`strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes:
true`. No `any` (lint error; `unknown` + narrowing). No enums (union
literals). No default exports except Svelte components and `+page`/`+server`
conventions. Shared client/server types live in `lib/api-types.ts` only.

## 3. Svelte 5 rules

- Runes only (`$state`, `$derived`, `$effect`, `$props`); legacy stores only
  where a shared singleton is genuinely needed (`stores/` wraps runes in
  classes instead where possible).
- `$effect` requires a comment stating what it synchronizes; effects that
  fetch are forbidden (fetching goes through swr/service layer).
- `{@html}` policy per doc 15 §4.
- No component > 300 lines; split view/logic (`service.ts`) beyond that.

## 4. Lint / format / dead code

- ESLint 9 flat config: `typescript-eslint` strict-type-checked +
  `eslint-plugin-svelte` recommended + custom rules: no-restricted-imports
  (cross-widget imports, doc 03 §"boundaries"), `svelte/no-at-html-tags`
  error, no `console.log` (only warn/error which the ring buffer wraps).
- Prettier 3 + svelte + tailwind plugins; no style debates, CI runs
  `--check`.
- **knip** CI-blocking: unused files/exports/deps fail. Widget manifests
  are entry points (knip config lists `src/lib/widgets/*/manifest.ts` +
  routes + service worker).
- `svelte-check` in CI (template type errors).

## 5. Commits & PRs

Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `perf:`,
`refactor:`, scope = widget id or area: `feat(markets): …`). Squash-merge;
PR title becomes the commit. Solo-dev discipline: PRs still used for
anything touching `core/` or `routes/api/` (CI gates run there); direct
pushes acceptable for docs. Release tags `v1.0.0` semver.

## 6. Bundle budgets (CI gate)

| Chunk | Budget (gzip) |
|-------|---------------|
| Entry (shell + registry + tier-1 essentials) | ≤ 200 KB JS |
| CSS total | ≤ 45 KB |
| Each widget tile chunk | ≤ 40 KB |
| Detail chunks w/ ECharts (weather, currency, markets) | ≤ 350 KB each, excluding the shared echarts chunk |
| Shared echarts core chunk (lazy, counted once) | ≤ 330 KB |
| maplibre chunk (map detail only) | ≤ 300 KB |
| Fonts total (both families, subsets) | ≤ 220 KB |

> Corrected 2026-08-10, two ways. `timer` was listed as an ECharts detail
> chunk, but doc 07 §2 specifies its history view as an inline SVG bar
> sparkline with no chart library — it now falls under the per-widget rows.
> And the shared echarts chunk had no row of its own even though spike S4
> (doc 22) measures it at ≤ 330 KB gz; that row now exists, so the budget the
> spike checks is the budget this table states.

Enforced by a `scripts/check-budgets.mjs` reading the Rolldown manifest in
CI (`pnpm build && pnpm budgets`); budget table lives in one JSON consumed
by both the script and this doc's regeneration. Bundle visualizer
(`rolldown` stats → treemap) run on demand: `pnpm build:analyze`.

## 7. Performance conventions

- Lazy: detail components, echarts, maplibre, music-metadata worker —
  never in entry. `import()` inside manifests only (doc 06 §1).
- Lists ≥ 200 rows use the internal windowing helper (music library).
- Images: none remote (CSP); local assets pre-optimized; icon sprite
  inlined SVG symbols.
- No layout thrash: ResizeObserver batched in the host; charts resize via
  their own observer with 150 ms debounce.
- Web Workers: tag parsing (music) mandatory; lunar batch calc if calendar
  year-view ever lands (v1.x).

## 8. Docs upkeep

Docs 04–11 contain constants (TTLs, budgets, limits) that also exist in
code. Single-source rule: constants live in
`src/lib/shared-constants.ts` (client+server importable) and
`scripts/budgets.json`; tests assert docs' tables match (§ doc 19 §3.5).
When behavior changes, the PR must update the doc file in the same commit
(`docs:` scope) — checked by reviewer (self-) discipline, not tooling.
