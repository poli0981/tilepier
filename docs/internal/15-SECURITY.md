# 15 · Security

## 1. Threat model (right-sized)

Assets: user's local data (notes/todos/files) and the free-tier API quotas.
No accounts, no server-side user data → classic web-app auth threats don't
apply. Realistic threats: (a) XSS via third-party content (RSS, ID3 tags,
markdown), (b) SSRF/abuse through the RSS proxy, (c) quota-drain /
scraping of `/api/*`, (d) supply-chain via npm. Mitigations below map 1:1.

## 2. Headers (set in `hooks.server.ts` for all HTML responses)

```
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';        // Svelte transition inline styles
  img-src 'self' data: blob: https://tiles.openfreemap.org;
  media-src 'self' blob:;
  connect-src 'self' https://tiles.openfreemap.org;
  font-src 'self';
  worker-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self), microphone=(), camera=(), payment=()
Cross-Origin-Opener-Policy: same-origin
```

**How these are actually delivered (corrected 2026-08-10).** The heading above
said "set in `hooks.server.ts` for all HTML responses". Both halves were wrong:

1. **The hook never runs for most pages.** The shell and the legal pages are
   prerendered and served straight from the ASSETS binding, so `handle` is
   bypassed. Everything except CSP therefore lives in the root `_headers` file,
   with `hooks.server.ts` keeping a copy for dynamically rendered responses.
2. **`script-src 'self'` alone breaks the app.** This doc claimed "scripts stay
   strict (no inline, no eval — Rolldown output complies)". Rolldown does
   comply; SvelteKit does not. It emits a small inline `<script>` carrying
   hydration data, and a bare `script-src 'self'` blocks it. The page still
   renders perfectly — only interactivity dies, silently. Found by an e2e test
   where clicking the gate's accept button did nothing.

   The CSP is therefore emitted by SvelteKit itself, configured in
   `svelte.config.js` under `kit.csp` with `mode: 'hash'`, so the policy
   carries a `sha256-` hash for that script. Hash rather than nonce because a
   nonce must be unique per response and prerendered pages cannot have one.
   Never add a second CSP in `_headers` or the hook: browsers enforce each
   policy independently, so a second one without the hash re-breaks hydration.

   One exception is required: `frame-ancestors` is ignored in a `<meta>` CSP by
   specification, so SvelteKit drops it from the tag. `_headers` sends a
   header containing only `frame-ancestors 'none'`, which stacks safely.

`upgrade-insecure-requests` has a local-development consequence worth knowing:
over plain HTTP it rewrites every subresource request to HTTPS, so the e2e
suite runs `wrangler dev --local-protocol https`.

Notes: RSS item images are **not** loaded (summary text only, doc 08 §4 —
`img` allowlisted in DOMPurify but CSP img-src blocks third-party hosts;
therefore strip `img` in the sanitizer allowlist instead to avoid broken
icons → **decision: no `img` in RSS reader v1**). `'unsafe-inline'` for
styles is the pragmatic Svelte cost; scripts stay strict (no inline, no
eval — Rolldown output complies).

## 3. `/api/*` protections

1. Cloudflare zone: Bot Fight Mode ON, Free Managed Ruleset ON, the one
   free rate-limit rule on `/api/*` (doc 11 §7). Turnstile deliberately
   **not** used in v1 (no forms; adding challenges to GET APIs hurts UX
   more than it protects a $0 quota) — revisit if abuse observed.
2. Origin discipline: browsers send `Sec-Fetch-Site`; requests with
   `Sec-Fetch-Site: cross-site` to `/api/*` → 403 (cheap hotlink stop;
   absent header (curl) allowed — public data, we only deter mass
   browser-embedding).
3. No CORS headers on `/api/*` (same-origin only by default) — other sites
   cannot read responses.
4. Input validation per doc 11 §8; symbol/url/coord allowlists.

## 4. Client-side injection surfaces

| Surface | Rule |
|---------|------|
| Notes markdown | `marked` → `DOMPurify` allowlist (no raw HTML pass-through, no img? — notes MAY keep https img; local user's own content, low risk → allow `img[src^=https]`) |
| RSS summaries | DOMPurify strict allowlist, **no img**, links `rel="noopener noreferrer" target="_blank"` |
| ID3/metadata strings | rendered as text nodes only — never `{@html}` |
| Geocode/place names | text nodes only |
| Any `{@html}` | requires a `// SAFETY:` comment naming the sanitizer; ESLint `svelte/no-at-html-tags` set to error with per-line disable only |

## 5. RSS proxy SSRF guard (`/api/rss`)

- `https:` scheme only; reject userinfo, ports other than 443, IP-literal
  hosts, `.onion`/`.local`/`.internal` TLDs, and hostnames resolving to
  private ranges is not checkable in Workers — compensate: Workers fetch
  cannot reach RFC1918 anyway (no private network path from CF edge), plus
  hostname pattern denylist above.
- Redirect limit 3, same-scheme only; 8 s timeout; 1 MB cap; response
  `content-type` must contain `xml` or `rss`/`atom` markers in first 512 B.
- Per-feed cache keys are hash-based → cache can't be poisoned across
  feeds; no request headers forwarded from client except none.

## 6. Supply chain

- `pnpm` with lockfile, `--frozen-lockfile` in CI; Renovate PRs only.
- `pnpm audit --prod` CI gate; `minimumReleaseAge`-style caution: Renovate
  configured with `stabilityDays=3` for non-security updates.
- No postinstall scripts allowed. **Mechanism updated 2026-08-10:** pnpm 11 no
  longer reads the `pnpm` field from `package.json` and renamed the setting, so
  the allowlist is `allowBuilds` in **`pnpm-workspace.yaml`**. Deny by default;
  extend one package at a time with a written reason.
  Currently allowed, each verified as required for the toolchain to run:
  `workerd` (Cloudflare runtime binary — wrangler/miniflare cannot start
  without it) and `esbuild`. **Correction:** this doc previously claimed
  "esbuild not needed under Vite 8/Rolldown". Verified at install — that is
  wrong: esbuild is a direct dependency of `vite@8.2.1` itself (and of
  wrangler), used for TS transform and dependency pre-bundling. Rolldown owns
  the production bundle, not the whole toolchain. `msw` is denied; its worker
  script is generated deliberately with `pnpm exec msw init static/` when
  component tests land, rather than as an install side effect.
- pnpm 11 additionally gates packages published inside its minimum-release-age
  window; conscious exceptions are listed in `minimumReleaseAgeExclude`. This
  is the same caution asked of Renovate below, now enforced at install time.
- No CDN scripts/fonts — everything bundled/self-hosted (also a CSP
  consequence). CI grep forbids `https://cdn`, `unpkg`, `jsdelivr`,
  `googleapis` in `src/` and build output.
- Secrets only in Wrangler secrets / GitHub Actions secrets; CI grep for
  key patterns in the client bundle (doc 21 §5).

## 7. Privacy engineering (enforcement of doc 16 §3)

- Coordinates rounded to 2 dp client-side before any request.
- IP never stored: soft limiter hashes with a rotating daily salt held in
  KV (`rl:salt:<date>`, generated via `crypto.getRandomValues`, auto-TTL).
- No cookies at all (verify in CI: response header scan).
- `<a>` external links: `rel="noopener noreferrer"`; Referrer-Policy above.

## 8. Security response

`SECURITY.md` in repo: private reporting via GitHub Security Advisories,
response target 72 h, supported version = latest only. Dependabot/GHSA
alerts enabled on the repo.
