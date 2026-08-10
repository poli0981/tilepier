# 02 · Tech Stack (locked 2026-07-19)

Versions verified against npm/official release channels on 2026-07-19;
re-checked against the live registry **2026-08-10** (see §Version & CVE policy
note 7 for what moved).
Rule: pin minors in `package.json` (`^` within major), let Renovate raise PRs.

## Runtime & tooling

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | **24.x (Active LTS)** | `"engines": { "node": ">=24" }`; EOL 2028-04. Node 26 is Current, not LTS until 2026-10 — do not target it. |
| pnpm | **11.x** | Raised from 10.x on 2026-08-10 (11.15.1 is the installed toolchain; no v1 feature depends on 10.x behaviour). Workspace not needed (single package). `packageManager` field pinned. |
| TypeScript | **6.0.x** | Supported by SvelteKit ≥ 2.56. `strict: true`. TS **7.0.2** is out (2026-08) — deliberately not taken yet, see §Version & CVE policy note 7. |
| Vite | **8.x** | Rolldown bundler (stable since 8.0, 2026-03). `build.rolldownOptions` (renamed from `rollupOptions`). |

## Framework & core libs

| Component | Version | Role / rationale |
|-----------|---------|------------------|
| Svelte | **5.x** (runes) | Compiler output small; runes for all state. No legacy `$:` syntax anywhere. |
| SvelteKit | **≥ 2.69.3** | App framework + server endpoints (`/api/*`) running in the Worker. **Floor is a security floor:** 2.57.1 patched a remote-functions auth bypass; never pin below it. We do not use remote functions in v1, but keep the floor anyway. |
| @sveltejs/adapter-cloudflare | latest 7.x | Emits a single Worker with static assets; KV bindings via `platform.env`. |
| Tailwind CSS | **4.3** | Same as SoftHarbor / poli0981.dev. CSS-first config (`@theme`), no `tailwind.config.js`. |
| gridstack | **12.6.x** | MIT, zero-dep, TS, touch + RTL. Drives the dashboard grid imperatively (doc 06 §5). gridstack **13.0.2** is out (2026-08) — held until Spike S1 is green, see §Version & CVE policy note 7. |
| echarts | **6.1.x** | Apache-2.0. Design-token themes + dynamic theme switching (no dispose on dark/light toggle). Always lazy-imported per detail view; tree-shaken imports only (`echarts/core` + used charts/components). |
| dexie | **4.x** | IndexedDB wrapper: notes, todos, events, playlists, blobs, handles (doc 05). |
| @inlang/paraglide-js | **2.x** | Compile-time i18n, EN/VI (doc 14). |
| maplibre-gl | **5.x** | BSD-3. Map widget only; lazy chunk. Tiles: OpenFreeMap (doc 10 §6). |
| music-metadata | latest | Browser build; ID3/FLAC/Vorbis tags + cover art for the music widget. |
| marked + dompurify | latest | Notes markdown preview. DOMPurify mandatory before any `{@html}`. |
| fast-xml-parser | **5.x** | Server-side RSS/Atom/RDF parsing in the Worker (doc 10 §7). Added 2026-08-10 — it was required by docs 10 and 16 but missing from this table. |
| vite-plugin-pwa | latest | Workbox precache + offline fallback (doc 17). Subject to Spike S5. |

Deliberately **not** used: no UI component library (design system is bespoke,
doc 12), no state library (runes suffice), no axios (native `fetch`), no
moment/dayjs (`Intl` + small internal date utils + lunar module), no CDN-loaded
scripts of any kind (doc 15 §2).

## Quality & test tooling

| Tool | Version | Purpose |
|------|---------|---------|
| ESLint | **10.x** flat | + `typescript-eslint`, `eslint-plugin-svelte`. Corrected from 9.x on 2026-08-10 — 10.x is what the current SvelteKit scaffold generates a flat config for. |
| Prettier | 3.x | + `prettier-plugin-svelte`, `prettier-plugin-tailwindcss` |
| svelte-check | latest | Type-checks templates in CI |
| knip | latest | Dead code / unused deps / unused exports — CI-blocking (doc 20 §4) |
| Vitest | **4.x** | Unit + component (browser mode). Corrected from 3.x on 2026-08-10. |
| @vitest/browser-playwright + vitest-browser-svelte | latest | Component tests in browser mode. Replaces `@testing-library/svelte`, which is not the Vitest 4 idiom — corrected 2026-08-10 (doc 19 §1 follows). |
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
7. **Registry re-check 2026-08-10.** Two majors shipped since the 2026-07-19
   lock. Both are deliberately **not** taken yet; each gets its own PR under
   rule 1, not a silent bump during Week 0:
   - **TypeScript 7.0.2** — a major line change. `svelte-check` and
     `typescript-eslint` support must be verified before adopting, and Week 0
     should not be blocked on that. Stay on `^6.0.0` (resolves 6.0.3).
   - **gridstack 13.0.2** — held until **Spike S1 is green on 12.6**. Doc 06 §5
     specifies 12.6's exact API surface (`columnOpts`, `batchUpdate`,
     `enableMove`/`enableResize`, `destroy(false)`); running S1 on 13 would
     conflate "does gridstack × Svelte 5 work" with "what changed in 13".
     Re-run the S1 harness against 13 as the acceptance test for that bump.
   - **maplibre-gl 6.2.0** — held at `^5.24.0`. The map widget is Week 6; no
     reason to absorb a major before the code that uses it exists.
   Three more entries in the tables above were **wrong**, not merely stale, and
   have been corrected in place: ESLint is **10.x** (not 9.x), Vitest is
   **4.x** (not 3.x), and the Vitest 4 browser-mode story is
   `@vitest/browser-playwright` + `vitest-browser-svelte`, not
   `@testing-library/svelte`. Doc 19 §1's tooling table follows.

   **Verified by a real install on 2026-08-10** (`pnpm install` → `pnpm build`
   → `pnpm lint` → `pnpm test`, all green; 521 lockfile entries):
   Node 24.18.0 · pnpm 11.15.1 · TypeScript 6.0.3 · Vite 8.2.1 ·
   Svelte 5.56.8 · SvelteKit 2.70.2 · adapter-cloudflare 7.2.9 ·
   Tailwind 4.3.3 · gridstack 12.6.0 · echarts 6.1.0 · dexie 4.4.4 ·
   paraglide-js 2.23.2 · maplibre-gl 5.24.0 · music-metadata 11.14.0 ·
   marked 18.0.9 · dompurify 3.4.13 · fast-xml-parser 5.10.1 ·
   ESLint 10.8.1 · Prettier 3.9.6 · svelte-check 4.7.5 · knip 6.32.1 ·
   Vitest 4.1.10 · Playwright 1.62.1 · msw 2.15.0 · wrangler 4.120.0.
   The stack builds on Vite 8 / Rolldown with adapter-cloudflare, and
   `svelte-check` reports 0 errors across 510 files with
   `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` both on.
8. Browser support target: last 2 Chrome/Edge/Firefox/Safari + iOS 17+.
   Baseline features used: ES2023, `Intl.DateTimeFormat`, IndexedDB,
   Service Worker. Progressive: File System Access API (Chromium-only,
   feature-detected, doc 09 §2).
