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
  script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com;
  style-src 'self' 'unsafe-inline';        // Svelte transition inline styles
  img-src 'self' data: blob: https://tiles.openfreemap.org;
  media-src 'self' blob:;
  connect-src 'self' https://tiles.openfreemap.org https://cloudflareinsights.com;
  frame-src https://challenges.cloudflare.com;
  font-src 'self';
  worker-src 'self';
  frame-ancestors 'none';
  base-uri 'self';
  form-action 'self';
  object-src 'none';
  upgrade-insecure-requests
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
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

**What production actually sends (measured 2026-09-23).** The e2e suite
asserts these headers against local `wrangler dev`, which is the only place a
test can reach — and production is not identical, because the zone sits in
front of the Worker:

- **HSTS comes from the zone.** Its SSL/TLS HSTS setting replaces the Worker's
  `Strict-Transport-Security` at the edge, and it sends
  `max-age=31536000; includeSubDomains; preload`. This doc, `_headers` and
  `hooks.server.ts` said the same value without `preload`. All three now
  match what the zone sends, so local and production agree and the e2e
  assertion on `preload` pins it. `preload` is a commitment: it asks
  browsers to hard-code HTTPS for the domain and every subdomain, and leaving
  the preload list takes months. If the zone setting was not deliberate, turn
  it off there and remove `preload` from all three together.
- **Cloudflare adds `Nel` and `Report-To`** (Network Error Logging). A browser
  that fails to load the site reports the failure to Cloudflare. It is the
  infrastructure provider's feature rather than TilePier's, and doc 16 §3
  covers it under Cloudflare's own processing.

`upgrade-insecure-requests` has a local-development consequence worth knowing:
over plain HTTP it rewrites every subresource request to HTTPS, so the e2e
suite runs `wrangler dev --local-protocol https`.

Notes: RSS item images are **not** loaded (summary text only, doc 08 §4 —
`img` allowlisted in DOMPurify but CSP img-src blocks third-party hosts;
therefore strip `img` in the sanitizer allowlist instead to avoid broken
icons → **decision: no `img` in RSS reader v1**). `'unsafe-inline'` for
styles is the pragmatic Svelte cost; scripts stay strict (no inline, no
eval — Rolldown output complies).

**Two third-party script sources, since 2026-09-23, and no others.** This
section's policy was `script-src 'self'` with the single third-party host
`tiles.openfreemap.org` for images and fetches. It now names exactly two
Cloudflare services, each because it cannot be self-hosted:

- **Web Analytics** (doc 16 §3). The beacon is `script-src
  static.cloudflareinsights.com` and reports to `connect-src
  cloudflareinsights.com`. It sits at the end of `app.html`'s body, because a
  `<meta>` CSP only governs what follows it.
- **Turnstile** (§3 below). `api.js` is `script-src challenges.cloudflare.com`
  and its challenge frame is `frame-src challenges.cloudflare.com`. Cloudflare
  requires `api.js` from that exact URL, never proxied or cached.

`e2e/legal-gate.e2e.ts` parses the emitted policy and compares **exact sets**
for `default-src`, `script-src` (hashes aside), `connect-src` and `frame-src`,
so adding a source is a deliberate edit to this section and to that test, not
a side effect. The e2e browser maps all three Cloudflare hosts to
`~NOTFOUND`, so a test run never reports page views into production's
analytics or waits on Cloudflare.

## 3. `/api/*` protections

1. Cloudflare zone: Bot Fight Mode ON, Free Managed Ruleset ON, the one
   free rate-limit rule on `/api/*` (doc 11 §7). ~~Turnstile deliberately
   **not** used in v1 (no forms; adding challenges to GET APIs hurts UX
   more than it protects a $0 quota) — revisit if abuse observed.~~
   **Reversed 2026-09-23 — Turnstile now stands in front of `/api/*`**, on
   the owner's decision, ahead of the week that puts Twelve Data's
   800-credit day behind the proxy. The original objection was about UX,
   and the design answers it rather than overruling it:

   - **One check per page load, after the legal gate.** `TpBotCheck`
     renders the widget with `appearance: 'interaction-only'`, so most
     readers see nothing. When Cloudflare wants a click, a labelled dialog
     opens and takes focus.
   - **A stateless pass, not a session.** `POST /api/verify` trades the
     token (siteverify: success, action `app-open`, the request's own
     hostname) for `v1.<exp>.<nonce>.<d>.<mac>`: an HMAC under a key
     HKDF-derived from the Turnstile secret.
     - It lives an hour, in memory only, and travels as `x-tp-pass`.
     - No cookie and no KV entry are involved.
     - It is not bound to an address, because phones change IP between
       towers. The cost: a lifted pass works elsewhere until it expires, so
       the rate limiter and the budget guard still stand behind it.
   - **Deny by default, in one place.** The gate runs in `hooks.server.ts`
     before any endpoint, and exemptions are route ids (`/api/verify`,
     `/api/_health`). Refusal is `401 VERIFY_REQUIRED`, `no-store`. The
     client drops the refused pass (compare-and-swap, so a late tile cannot
     discard a newer pass) and retries once.
   - **What it protects is upstream spend, not the data.** The adapter
     replays cached GETs from `caches.default` *before* hooks run, so a URL
     already cached answers without a pass for up to half its TTL. That is
     public data at no cost. What the pass guards is the MISS that reaches
     an upstream — threat (c) in §1.
   - **siteverify down is not the app down.** A timeout, a 5xx or
     `internal-error` gets a ten-minute pass flagged degraded and a failure
     on the `turnstile` breaker, which `/api/_health` shows. A token Cloudflare
     *refused* is never softened. This is the rate limiter's fail-open
     reasoning: nobody outside Cloudflare can cause that outage.
   - **Off unless both halves are set.** With no secret (a checkout, CI)
     there is no gate and `GET /api/verify` says so. A secret without a
     sitekey is `misconfigured`: reported, not enforced, because no browser
     could pass it.
   - **The operator's bearer** (`DEV_DASH_TOKEN`) passes without a
     challenge, so curl spot checks and the S3 harness (doc 22) still work.
2. Origin discipline: browsers send `Sec-Fetch-Site`; requests with
   `Sec-Fetch-Site: cross-site` to `/api/*` → 403 (cheap hotlink stop;
   absent header (curl) allowed — public data, we only deter mass
   browser-embedding). **Since 2026-09-23 curl also needs a pass or the
   operator's bearer** whenever the gate is on. `POST /api/verify` checks
   `Origin` against the request's own origin itself, because SvelteKit's CSRF
   check covers form posts only.
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
  consequence), with the two named Cloudflare exceptions of §2. CI grep
  forbids `https://cdn`, `unpkg`, `jsdelivr`, `googleapis` in the build
  output. **Not in `src/`** — this line said both until 2026-09-23; the step in
  `ci.yml` has only ever read `.svelte-kit/cloudflare`.
- Secrets only in Wrangler secrets (as Secret-type variables — a Text-type
  one set in the dashboard is overwritten by the next `wrangler deploy`) /
  GitHub Actions secrets; CI grep for key names in the client bundle
  (doc 21 §5). Four of them: `FINNHUB_KEY`, `TWELVEDATA_KEY`,
  `DEV_DASH_TOKEN`, `TURNSTILE_SECRET_KEY`. A local run needs them in
  `.dev.vars`, which is gitignored; `.dev.vars.example` is committed, carries
  every name and **no value**, and is what `pnpm gen` types them from — so the
  names also appear, as types only, in the generated `worker-configuration.d.ts`
  (doc 11 §9). Neither file is part of any bundle.

## 7. Privacy engineering (enforcement of doc 16 §3)

- Coordinates rounded to 2 dp client-side before any request.
- IP never stored by TilePier's code: soft limiter hashes with a rotating
  daily salt held in KV (`kv:rl:salt:<date>`, generated via
  `crypto.getRandomValues`, auto-TTL). **Cloudflare's platform is a different
  matter, and doc 16 §3 now says so.** Workers invocation logs are on
  (`wrangler.jsonc` `observability`) and keep request metadata, the address
  included, for 7 days. `POST /api/verify` also forwards the address to
  siteverify as `remoteip`, as Turnstile asks.
- No cookies at all. This is asserted by the header e2e on `/` against local
  `wrangler dev`. It said "verify in CI: response header scan", and no such
  scan exists. Neither Cloudflare service sets one on this origin: Web
  Analytics uses no client state, and Turnstile runs in its own frame.
- `<a>` external links: `rel="noopener noreferrer"`; Referrer-Policy above.

## 8. Security response

`SECURITY.md` in repo: private reporting via GitHub Security Advisories,
response target 72 h, supported version = latest only. Dependabot/GHSA
alerts enabled on the repo.
