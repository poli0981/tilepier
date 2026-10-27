# Running your own TilePier

TilePier is one Cloudflare Worker that serves the app and its `/api/*` proxy,
plus a KV namespace for the proxy's cache. This guide is what a copy of it on
your own domain needs. It assumes a Cloudflare account with a zone (a domain)
on it, Node 26 and pnpm 11 (`.node-version` and `package.json`'s
`packageManager`). If you build with Workers Builds, set its `NODE_VERSION`
and `PNPM_VERSION` variables to match: its own defaults are older.

Some of the steps are not optional. A copy that skips them reports its visitors
to the original's analytics, identifies itself to OpenStreetMap's servers as
tilepier.win, and shows legal pages that describe someone else's service.

## 1. What to change in your fork

**The analytics beacon, in `src/app.html`.** The script tag near the end of
the body carries tilepier.win's Cloudflare Web Analytics token. Remove the tag,
or create a Web Analytics site of your own and use its token. Left as it is,
your visitors are counted in the original's dashboard.

**The KV namespace, in `wrangler.jsonc`.** Create your own and put its ids in
`kv_namespaces`, keeping the binding name `TILEPIER_CACHE`:

```bash
pnpm exec wrangler kv namespace create TILEPIER_CACHE
pnpm exec wrangler kv namespace create TILEPIER_CACHE --preview
```

**The Turnstile site key, in `wrangler.jsonc` (`vars.TURNSTILE_SITE_KEY`).**
Create a Turnstile widget for your domain and use its site key, or leave the
secret unset (step 2): with no secret there is no bot check, and `/api/*` is
open.

**The domain, written into the code in five places:**

| File                                 | What it is                                                         |
| ------------------------------------ | ------------------------------------------------------------------ |
| `src/lib/shared-constants.ts`        | `OWN_DOMAIN`, so a feed on your own domain is refused              |
| `src/routes/api/geocode/+server.ts`  | the User-Agent Nominatim's usage policy requires to name you       |
| `src/routes/api/rss/+server.ts`      | the User-Agent feeds see                                           |
| `src/routes/api/_lib/probe.ts`       | the User-Agent of the upstream probe                               |
| `static/.well-known/security.txt`    | `Canonical`, `Contact` and `Policy`, with `SECURITY.md` beside it  |

**The legal pages.** The terms, the privacy page and the about page describe
tilepier.win and its operator, in both languages: the `legal.*` and `about.*`
messages in `messages/en.json` and `messages/vi.json`, and the pages under
`src/routes/legal/` and `src/routes/about/`. They are yours to rewrite for
your service; the licences page is generated (`pnpm licenses:gen`) and stays
correct by itself.

## 2. Secrets

Set these as **Secret**-type variables, with `wrangler secret put <NAME>` or in
the dashboard. A Text-type variable is overwritten by the next deploy.

| Secret                 | What it does                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| `FINNHUB_KEY`          | Stock quotes and search in Markets ([finnhub.io](https://finnhub.io), free)   |
| `TWELVEDATA_KEY`       | Stock charts in Markets ([twelvedata.com](https://twelvedata.com), free tier) |
| `TURNSTILE_SECRET_KEY` | The bot check in front of `/api/*`; unset means no check                      |
| `DEV_DASH_TOKEN`       | A random string of 32 characters or more; gates `GET /api/_health`            |

Without the two market keys, Markets shows coins only. Everything else works
with no keys at all.

## 3. Build and deploy

With Cloudflare's Git integration (Workers Builds), set in the Worker's
Settings → Builds:

| Field                        | Value                 |
| ---------------------------- | --------------------- |
| Build command                | `pnpm run build`      |
| Deploy command               | `npx wrangler deploy` |
| Variable `NODE_VERSION`      | `26`                  |
| Variable `PNPM_VERSION`      | `11`                  |

Leaving the build command empty fails the deploy: nothing produces
`.svelte-kit/cloudflare/_worker.js`. From your own machine instead,
`pnpm run deploy:prod` builds and deploys.

**Bind your domain in the dashboard** (the Worker's Settings → Domains &
Routes). `wrangler.jsonc` deliberately has no `routes`, so a deploy can never
rebind a hostname. `workers_dev` is off, so the app has exactly one origin.

## 4. In the Cloudflare dashboard

- **A rate-limiting rule on the zone, the first layer.** The Worker limits
  itself (below), but each request it refuses has still invoked it; this rule
  turns a flood away before that. A Free zone gets one rule, matched on the
  path, counted per IP over 10 seconds, blocking for 10 seconds. In the zone,
  open **Security → WAF → Rate limiting rules → Create rule** (in the newer
  dashboard, **Security → Security rules → Create rule → Rate limiting
  rule**) and set:

  | Field | Value |
  | --- | --- |
  | Rule name | `api flood` |
  | If incoming requests match | Field **URI Path**, operator **starts with**, value `/api/` |
  | Expression (if you edit it instead) | `(starts_with(http.request.uri.path, "/api/"))` |
  | With the same characteristics | **IP** |
  | When rate exceeds | **60** requests per **10 seconds** |
  | Then take action | **Block** |
  | Response | Default |
  | For duration | **10 seconds** |

  Deploy it. Cloudflare's own 429 carries `Retry-After`, and the app reads it as
  "rate limited" and waits that long.
  `ZONE_RATE_LIMIT` in `src/lib/shared-constants.ts` mirrors these numbers for
  the feed reader, which paces itself to half of them; change both together.

  **Why `/api/` and not the whole site.** Static files and prerendered pages
  are served without running the Worker, cost nothing, and sit behind
  Cloudflare's automatic DDoS protection. A first visit legitimately sends
  about 400 requests in a second (the page's chunks, then the service worker
  caching the app shell), so a whole-site rule strict enough to matter would
  block real readers. If you want one anyway, exclude the chunks and allow at
  least 150: `(not starts_with(http.request.uri.path, "/_app/immutable/"))`,
  150 per 10 seconds. That gives up the tighter `/api/` wall.

- **The Worker's own limiter needs nothing from you.** It is two Rate Limiting
  bindings in `wrangler.jsonc`, deployed with the Worker: 30 requests per
  10 seconds per client on `/api/*`, and 30 on the pages the Worker renders
  (404s), answering `429` with `retry-after: 10`. Their `namespace_id`s must be
  unique in your account; change them if another Worker of yours already uses
  `27101` or `27102`.
- **KV writes no longer call for Workers Paid.** Until 2026-10-27 the rate
  limiter wrote to KV on every `/api/*` request, and the free plan's 1,000
  writes a day ran out at about a thousand. They now go to cache misses, fx
  snapshots and breaker changes. The free plan's other limits still apply.
- **HSTS** belongs to the zone (SSL/TLS → Edge Certificates). The app sends
  `max-age=31536000; includeSubDomains; preload` to match tilepier.win's zone;
  `preload` is a commitment that takes months to undo, so turn it on in the
  zone only if you mean it, and take it out of `src/lib/server/security-headers.ts`
  and `_headers` if you do not.

## 5. Check it

After a deploy:

```bash
S3_BASE_URL=https://your.domain pnpm exec playwright test e2e/prod-headers.e2e.ts
```

checks the security headers and `security.txt` on your origin. Then open the
site in a fresh profile: the legal gate first, then the deck, with no CSP
errors in the console.

## Your obligations

TilePier is GPL-3.0-only. That licence (unlike the AGPL) does not oblige you to
publish your changes just because you run them as a website, but if you
distribute the code, modified or not, it comes with its source and the same
licence. The data sources keep their own terms, and the licences page lists
what each one asks; Open-Meteo, for one, is free for non-commercial use only.
