# 02 · Tech Stack (locked 2026-07-19)

Versions verified against npm/official release channels on 2026-07-19.
Rule: pin minors in `package.json` (`^` within major), let Renovate raise PRs.

## Runtime & tooling

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | **24.x (Active LTS)** | `"engines": { "node": ">=24" }`; EOL 2028-04. Node 26 is Current, not LTS until 2026-10 — do not target it. |
| pnpm | **10.x** | Workspace not needed (single package). `packageManager` field pinned. |
| TypeScript | **6.0.x** | Supported by SvelteKit ≥ 2.56. `strict: true`. |
| Vite | **8.x** | Rolldown bundler (stable since 8.0, 2026-03). `build.rolldownOptions` (renamed from `rollupOptions`). |

## Framework & core libs

| Component | Version | Role / rationale |
|-----------|---------|------------------|
| Svelte | **5.x** (runes) | Compiler output small; runes for all state. No legacy `$:` syntax anywhere. |
| SvelteKit | **≥ 2.69.3** | App framework + server endpoints (`/api/*`) running in the Worker. **Floor is a security floor:** 2.57.1 patched a remote-functions auth bypass; never pin below it. We do not use remote functions in v1, but keep the floor anyway. |
| @sveltejs/adapter-cloudflare | latest 7.x | Emits a single Worker with static assets; KV bindings via `platform.env`. |
| Tailwind CSS | **4.3** | Same as SoftHarbor / poli0981.dev. CSS-first config (`@theme`), no `tailwind.config.js`. |
| gridstack | **12.6.x** | MIT, zero-dep, TS, touch + RTL. Drives the dashboard grid imperatively (doc 06 §5). |
| echarts | **6.1.x** | Apache-2.0. Design-token themes + dynamic theme switching (no dispose on dark/light toggle). Always lazy-imported per detail view; tree-shaken imports only (`echarts/core` + used charts/components). |
| dexie | **4.x** | IndexedDB wrapper: notes, todos, events, playlists, blobs, handles (doc 05). |
| @inlang/paraglide-js | **2.x** | Compile-time i18n, EN/VI (doc 14). |
| maplibre-gl | **5.x** | BSD-3. Map widget only; lazy chunk. Tiles: OpenFreeMap (doc 10 §6). |
| music-metadata | latest | Browser build; ID3/FLAC/Vorbis tags + cover art for the music widget. |
| marked + dompurify | latest | Notes markdown preview. DOMPurify mandatory before any `{@html}`. |
| vite-plugin-pwa | latest | Workbox precache + offline fallback (doc 17). Subject to Spike S5. |

Deliberately **not** used: no UI component library (design system is bespoke,
doc 12), no state library (runes suffice), no axios (native `fetch`), no
moment/dayjs (`Intl` + small internal date utils + lunar module), no CDN-loaded
scripts of any kind (doc 15 §2).

## Quality & test tooling

| Tool | Version | Purpose |
|------|---------|---------|
| ESLint | 9.x flat | + `typescript-eslint`, `eslint-plugin-svelte` |
| Prettier | 3.x | + `prettier-plugin-svelte`, `prettier-plugin-tailwindcss` |
| svelte-check | latest | Type-checks templates in CI |
| knip | latest | Dead code / unused deps / unused exports — CI-blocking (doc 20 §4) |
| Vitest | 3.x | Unit + component (browser mode where needed) |
| @testing-library/svelte | latest | Component tests |
| Playwright | latest | E2E smoke suite (doc 19 §4) |
| msw | 2.x | API mocking in unit/component tests |

## Version & CVE policy

1. **Renovate** (config in repo) groups patch updates weekly, majors individually.
2. `pnpm audit --prod` runs in CI; high/critical findings fail the build.
3. **CodeQL** `javascript-typescript` via the shared reusable workflow (doc 21).
4. Known-issue register (keep updated):
   - SvelteKit < 2.57.1 — remote-functions auth bypass → floor set above.
   - Vite dev-server file-read CVEs (2025, `CVE-2025-30208` family) were
     dev-mode only and are irrelevant on Vite 8, but never expose `vite dev`
     to a network interface anyway (`--host` forbidden in scripts).
   - gridstack, echarts, dexie, maplibre: no unpatched critical CVEs known at
     lock date. Re-verify at each Renovate major PR.
5. Lockfile is committed; CI uses `--frozen-lockfile`.
6. Browser support target: last 2 Chrome/Edge/Firefox/Safari + iOS 17+.
   Baseline features used: ES2023, `Intl.DateTimeFormat`, IndexedDB,
   Service Worker. Progressive: File System Access API (Chromium-only,
   feature-detected, doc 09 §2).
