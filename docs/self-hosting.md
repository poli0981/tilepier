# Running your own TilePier

TilePier is one Cloudflare Worker that serves the app and its `/api/*` proxy,
plus a KV namespace for the proxy's cache. This guide is what a copy of it on
your own domain needs. It assumes a Cloudflare account with a zone (a domain)
on it, Node 24 and pnpm 11.

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

| Field          | Value                |
| -------------- | -------------------- |
| Build command  | `pnpm run build`     |
| Deploy command | `npx wrangler deploy` |

Leaving the build command empty fails the deploy: nothing produces
`.svelte-kit/cloudflare/_worker.js`. From your own machine instead,
`pnpm run deploy:prod` builds and deploys.

**Bind your domain in the dashboard** (the Worker's Settings → Domains &
Routes). `wrangler.jsonc` deliberately has no `routes`, so a deploy can never
rebind a hostname. `workers_dev` is off, so the app has exactly one origin.

## 4. In the Cloudflare dashboard

- **A rate-limiting rule on the zone**: path `/api/*`, 60 requests a minute per
  IP, block for 60 seconds. The Worker's own limiter is approximate; this is
  the wall. The app's feed reader paces itself to half of it
  (`ZONE_RATE_LIMIT` in `src/lib/shared-constants.ts` mirrors the numbers).
- **Workers Paid is recommended.** The Worker's soft rate limiter writes to KV
  on every `/api/*` request, and the free plan's 1,000 KV writes a day run out
  at about a thousand API requests.
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
