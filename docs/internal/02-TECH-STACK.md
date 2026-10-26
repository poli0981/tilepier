# 02 · Tech Stack (locked 2026-07-19)

Versions verified against npm/official release channels on 2026-07-19;
re-checked against the live registry **2026-08-10** and **2026-10-26** (see
§Version & CVE policy notes 7 and 9 for what moved).
Rule: pin minors in `package.json` (`^` within major), let Dependabot raise PRs
(doc 21 §6).

## Runtime & tooling

| Component | Version | Notes |
|-----------|---------|-------|
| Node.js | **26.x** | `.node-version` (`26`) is the one source: CI's setup-node reads it, and Workers Builds' `NODE_VERSION` variable matches it (doc 21 §4). `"engines": { "node": ">=26" }`. Raised from 24 on 2026-10-26, at the owner's call, two days before 26 became LTS (2026-10-28). Node 26 ships without corepack: install it with `npm install --global corepack@latest`. |
| pnpm | **11.x** | 11.28.8 since 2026-10-26 (raised from 10.x on 2026-08-10). Workspace not needed (single package). `packageManager` field pinned; Workers Builds' `PNPM_VERSION` is `11`. pnpm 12, a rewrite in Rust, is held: see note 9. |
| TypeScript | **7.0.x** for `tsc`, **6.0.x** for the tools | Taken 2026-10-26 as the TypeScript team recommends while 7.0 has no API: `typescript` is `npm:@typescript/typescript6` (the 6.0 API svelte-check, typescript-eslint, SvelteKit's sync and Paraglide's declarations load) and `@typescript/native` is `npm:typescript@7`, whose `tsc` is the `pnpm typecheck` gate. `strict: true`, `target`/`lib` ES2025. See note 9. |
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
| @inlang/plugin-message-format + @inlang/plugin-m-function-matcher | latest | inlang project plugins, devDeps. Referenced from `project.inlang/settings.json` by `node_modules` path rather than the usual jsdelivr URL, so the build never fetches at compile time — added 2026-08-19, see doc 14 §1. |
| maplibre-gl | **6.12.x** (5.x until 2026-09-23, rule 7) | BSD-3. Map widget only; lazy chunk. Tiles: OpenFreeMap (doc 10 §6). Held at `~6.12` by the bundle budget, note 9. |
| music-metadata | latest | Browser build; ID3/FLAC/Vorbis tags + cover art for the music widget. |
| marked + dompurify | latest | Notes markdown preview. DOMPurify mandatory before any `{@html}`. |
| fast-xml-parser | **5.x** | Server-side RSS/Atom/RDF parsing in the Worker (doc 10 §7). Added 2026-08-10 — it was required by docs 10 and 16 but missing from this table. |
| qrcode-generator | **2.0.x** | MIT, **zero dependencies**, by the original author. The toolbox's QR tab (doc 07 §7). Added 2026-08-28 — that section says "small vendored QR encoder", and vendoring was measured before it was rejected: Nayuki's TypeScript source is 990 lines and produces **43 errors** under this repo's `noUncheckedIndexedAccess`, so carrying it verbatim would have meant `@ts-nocheck` plus exclusions in eslint, prettier, knip and coverage — five holes in a repo that has none. A zero-dep package goes through Dependabot and `pnpm audit` like everything else. `qrcode` was the alternative doc 07 §7 named and is not it: three transitive dependencies including `yargs`. |
| vite-plugin-pwa | latest | Workbox precache + offline fallback (doc 17). Subject to Spike S5. |

Deliberately **not** used: no UI component library (design system is bespoke,
doc 12), no state library (runes suffice), no axios (native `fetch`), no
moment/dayjs (`Intl` + small internal date utils + lunar module), no CDN-loaded
scripts (doc 15 §2) — with exactly two named exceptions since 2026-09-23, both
Cloudflare services that cannot be self-hosted: the Web Analytics beacon, which
Cloudflare versions, and Turnstile's `api.js`, which refuses to run from a
proxied or cached copy. Neither is a dependency, and neither is counted by the
bundle budgets (doc 20 §6).

## Quality & test tooling

| Tool | Version | Purpose |
|------|---------|---------|
| ESLint | **10.x** flat | + `typescript-eslint`, `eslint-plugin-svelte`. Corrected from 9.x on 2026-08-10 — 10.x is what the current SvelteKit scaffold generates a flat config for. |
| Prettier | 3.x | + `prettier-plugin-svelte`, `prettier-plugin-tailwindcss` |
| svelte-check | latest | Type-checks templates in CI, through the TypeScript 6.0 API (note 9); `tsc` 7 checks the `.ts` files beside it |
| knip | latest | Dead code / unused deps / unused exports — CI-blocking (doc 20 §4) |
| Vitest | **5.x** | Unit + component (browser mode). Corrected from 3.x on 2026-08-10; 5.x since 2026-10-26 (note 9). |
| @vitest/browser-playwright + vitest-browser-svelte | latest | Component tests in browser mode. Replaces `@testing-library/svelte`, which is not the Vitest 4 idiom — corrected 2026-08-10 (doc 19 §1 follows). |
| @vitest/coverage-v8 | latest | Coverage provider for the doc 19 §2 thresholds. Added 2026-08-19 — the thresholds were specified from the start but unenforceable without it. |
| Playwright | latest | E2E smoke suite (doc 19 §4) |
| @axe-core/playwright | 4.14 | Accessibility sweep in the E2E suite (doc 19 §4, Week 8); dev only, never shipped |
| msw | 3.x | API mocking in unit/component tests. 3.x since 2026-10-26: `onUnhandledFrame` replaced `onUnhandledRequest`, and it has no postinstall. |

## Version & CVE policy

1. **Dependabot** (`.github/dependabot.yml`, doc 21 §6) groups patch updates
   weekly, majors individually. This said Renovate until 2026-10-06; Renovate
   was never installed, and Dependabot's security updates were what ran.
2. `pnpm audit --audit-level high` runs in CI over **every** dependency —
   not `--prod`, which misses what ships from devDependencies (doc 15 §6);
   high/critical findings fail the build.
3. **CodeQL** `javascript-typescript` and `actions` via the shared reusable
   workflow, on pull requests too (doc 21). **SonarQube Cloud** analyses every
   pull request and `main` in CI, with coverage, and its quality gate is a
   required check (doc 21 §8, since 2026-10-26).
4. Known-issue register (keep updated):
   - SvelteKit < 2.57.1 — remote-functions auth bypass → floor set above.
   - Vite dev-server file-read CVEs (2025, `CVE-2025-30208` family) were
     dev-mode only and are irrelevant on Vite 8, but never expose `vite dev`
     to a network interface anyway (`--host` forbidden in scripts).
   - gridstack, echarts, dexie, maplibre: no unpatched critical CVEs known at
     lock date. Re-verify at each major PR.
5. Lockfile is committed; CI uses `--frozen-lockfile`.
7. **Registry re-check 2026-08-10.** Two majors shipped since the 2026-07-19
   lock. Both are deliberately **not** taken yet; each gets its own PR under
   rule 1, not a silent bump during Week 0:
   - **TypeScript 7.0.2** — a major line change. `svelte-check` and
     `typescript-eslint` support must be verified before adopting, and Week 0
     should not be blocked on that. Stay on `^6.0.0` (resolves 6.0.3).
     **Taken 2026-10-26**, as `tsc` with the 6.0 API alongside it (note 9).
   - **gridstack 13.0.2** — held until **Spike S1 is green on 12.6**. Doc 06 §5
     specifies 12.6's exact API surface (`columnOpts`, `batchUpdate`,
     `enableMove`/`enableResize`, `destroy(false)`); running S1 on 13 would
     conflate "does gridstack × Svelte 5 work" with "what changed in 13".
     Re-run the S1 harness against 13 as the acceptance test for that bump.
   - **maplibre-gl 6.2.0** — held at `^5.24.0`. The map widget is Week 6; no
     reason to absorb a major before the code that uses it exists.
     **Taken 2026-09-23, for a security fix:** GHSA-jrc7-96c5-q579 (critical,
     an XSS sanitizer bypass in `DOM.sanitize()`) is fixed only in ≥ 6.4.1, and
     5.24.0 is the last 5.x. Now `^6.10.0` — 6.11.0 was inside pnpm's
     minimum-release-age window that day. The only importer is still the S4
     harness, which asks for nothing but `Map`, and the chunk grew from 263.8
     to 274.1 KB gz against its 300 KB budget (doc 20 §6).
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
   feature-detected, doc 09 §2). **ES2025 in `tsconfig.json` (2026-10-26)
   is what code may name, not what the bundle is lowered to:** Vite's own
   browser target is unchanged, and ES2025 APIs iOS 17 lacks — iterator
   helpers, `Promise.try`, `RegExp.escape` — need feature detection like any
   progressive API. The lib was `esnext`, inherited from SvelteKit, until then.
9. **Registry re-check 2026-10-26** (Node 26, TypeScript 7, every dependency
   to its newest release at least three days old, doc 15 §6):
   - **TypeScript 7.0.2** taken, as the pair of aliases in the table above.
     7.0 has no programmatic API; svelte-check, typescript-eslint and
     SvelteKit accept only 6.x, and the TS team's own guidance is this pair.
     `pnpm typecheck` runs the native `tsc` over the app's tsconfig (every
     `.ts` and `.js` file it includes; svelte-check still covers `.svelte`)
     in under a second. Its first run found two named exports from `.svelte`
     modules, which plain `tsc` cannot see (it knows a Svelte file only as a
     default export): the map's types moved to `map/types.ts`, the throwing
     fixture's flag to `crash.ts`. **When svelte-check and typescript-eslint
     support 7.1's API, drop the alias and take `typescript@7` alone**;
     Dependabot ignores both names until then (doc 21 §6).
   - **maplibre-gl held at 6.12.** From 6.13 the worker bundles everything
     itself: the three vendored modules grow from about 300 KB to 438 KB
     gzipped, past the 300 KB budget (doc 20 §6), and `e2e/s4-budgets`
     expects the shared module. Raising the budget is the owner's decision,
     not a version bump's.
   - **pnpm 12 held.** It is a rewrite in Rust, shipped as native binaries.
     Neither Workers Builds nor the JSON `pnpm licenses list` gives
     `licenses:gen` was checked against it; 11.28.8 is the newest 11.
   - **`engineStrict` stays off.** `.npmrc`'s `engine-strict=true` had done
     nothing since pnpm 11, which reads only auth and registry settings from
     that file, and the file is gone. Turning the setting on where pnpm 11
     reads it (`pnpm-workspace.yaml`) would fail every install:
     svelte-eslint-parser, under eslint-plugin-svelte, declares
     `engines.pnpm` 10.34. `.node-version` and the dashboard's
     `NODE_VERSION` are what hold the Node version.
   - Taken: Svelte 5.57, Vite 8.3, ESLint 10.13, typescript-eslint 8.72,
     Playwright 1.64, axe 4.14, Paraglide 2.29, wrangler 4.152 (compatibility
     date 2026-10-19), dexie 4.4.7, marked 18.1, fast-xml-parser 5.11,
     @types/node 26. knip 6.42 rather than 6.43, which was two days old.
   - **The test stack's majors, together** (they pin each other): Vitest 5,
     @vitest/browser-playwright and coverage-v8 5, vitest-browser-svelte 3,
     msw 3. `render` and `unmount` are async now, so every call is awaited
     (475 of them, by a codemod), and `toHaveTextContent` and the text
     locators match the whole text: an assertion that meant a part says so
     with `toMatchTextContent` or `exact: false`. **music-metadata 12**
     (12.2.3; 12.3 was under three days old) changed nothing the tag worker
     calls.
