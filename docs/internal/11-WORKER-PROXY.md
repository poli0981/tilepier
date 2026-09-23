# 11 · Worker Proxy (`/api/*`)

## 1. Principles

1. Stateless, anonymous, boring. No user auth, no cookies, no user IDs, and
   no logs the Worker keeps itself (doc 16 §3). Two amendments, 2026-09-23:
   - `/api/*` sits behind a Turnstile **pass** (doc 15 §3). It is anonymous
     and stateless, an HMAC checked in `hooks.server.ts`, and it proves only
     that a real browser asked within the hour, not who.
   - Cloudflare's own invocation logs are on (`wrangler.jsonc`
     `observability`) and keep request metadata for 7 days. doc 16 §3 now
     says so, instead of "no persisted logs".
2. Every endpoint: validate → rate-gate → KV read → upstream (maybe) →
   normalize → KV write → respond. One shared pipeline in `routes/api/_lib`.
3. The Worker is the **only** holder of API keys.
4. Responses are our normalized shapes with a stable envelope — upstream
   quirks die at the edge.

## 2. Response envelope

```jsonc
// 200
{ "ok": true, "data": { ... }, "meta": { "cachedAt": 1756500000, "source": "open-meteo", "stale": false } }
// error
{ "ok": false, "error": { "code": "UPSTREAM_DOWN" | "RATE_LIMITED" | "BAD_REQUEST" | "QUOTA_EXHAUSTED" | "VERIFY_REQUIRED", "retryAfterS": 30 } }
```
`VERIFY_REQUIRED` (401, `no-store`, 2026-09-23) comes from the Turnstile gate in
`hooks.server.ts`, never from an endpoint: the request carried no pass, or one
that has expired or was not minted by this Worker (doc 15 §3). The client
retries once with a fresh pass (doc 17 §4).
Headers: `x-tp-cache: HIT|MISS|STALE`, `cache-control: public, max-age=<ttl/2>`
(lets the CF CDN + browser absorb repeat hits too), `retry-after` on 429/503.

## 3. Endpoints

| Route | Params | Upstream (doc 10) |
|-------|--------|-------------------|
| `GET /api/weather` | lat, lon (2 dp) | Open-Meteo forecast + AQI (parallel) |
| `GET /api/geocode` | q, lang | Photon → Nominatim |
| `GET /api/fx` | — (full USD table) | ER-API + snapshot side-effect |
| `GET /api/fx/history` | pair, days ∈ {7,30,90,365} | KV snapshots only |
| `GET /api/crypto/ticker` | symbols (≤12) | Binance ticker/24hr |
| `GET /api/crypto/klines` | symbol, interval, limit ∈ range set | Binance klines |
| `GET /api/stock/quote` | symbols (≤12, fanned ≤12 Finnhub calls, cached individually) | Finnhub |
| `GET /api/stock/series` | symbol, interval(15min\|1day), limit ∈ range set | Twelve Data (no fallback source since 2026-09-23, doc 10 §5) |
| `GET /api/stock/search` | q (1–40 chars: letters, digits, space, `. & ' -`) | Finnhub search |
| `GET /api/rss` | url (https) | arbitrary feed (guarded, doc 15 §5) |

All GET, all side-effect-free from the client's perspective (fx snapshot is
an idempotent internal write). Non-GET → 405.

**`days` is an allowlist, not a bound** (settled 2026-08-31; this row said
`days≤365` while doc 23 called it an allowlist, and they cannot both be right).
The response is CDN-cacheable by URL, so a free integer gives 365 distinct edge
entries *per pair* that one client can walk with a loop; four values give four.
It costs the reader nothing, because doc 08 §2’s detail offers ranges rather
than a number field — a range picker is an allowlist with a nicer name. A value
outside the list is `BAD_REQUEST` and never a silent clamp, which would file one
range’s answer under another range’s key.

**`limit` on the klines route is the same kind of allowlist**, and its values
are not written out anywhere: they are derived from `CRYPTO_RANGES` in
`api-types.ts`, the one module both halves import, so the endpoint refuses any
depth the range picker cannot ask for and the two cannot drift. Four arbitrary
integers would be a rule with no reason behind it (settled 2026-09-01; this row
said `limit≤500`).

**The klines cache holds one deep series and the response is a window onto it.**
§4 keys the payload `cr:kl:v1:<sym>:<int>` with **no depth in the key**, so two
ranges over the same symbol and interval would otherwise overwrite each other —
and because the payload shapes are identical, a reader who looked at 1W and then
1M would get 1W's candles under 1M's label with nothing to notice. The endpoint
therefore always fetches Binance's 500-candle maximum and slices. That depth
covers every range at every interval (500 × 5 min is 41 hours against 1D's 24;
500 hours is 20 days against 1W's 7; 500 days is sixteen months against 1Y's
twelve), and it costs one upstream call rather than one per range.

**`/api/stock/series` needs the same answer for the same reason**, and it is
recorded here rather than there because this is where it was first built: that
row's params included a `range` while §4's key is `st:se:v1:<sym>:<int>`, which
is the identical collision one endpoint later. Built in 5b the same way — one
deep series per interval (130 fifteen-minute bars, 260 sessions), `limit` an
allowlist derived from `STOCK_RANGES`, and the response a window onto it.

**The client asks for the deepest window, and windows it itself** (2026-09-23).
The collision above has a twin one layer up: `swr` keys the client's
`apiCache` the same way, with no depth, so through Week 5a a 1M response and a
1Y response were stored under one key and each range read the other's window as
fresh — a year of candles drawn under 1M's label. So each interval is requested
at the deepest `limit` any range asks of it (365 for `1d`, 252 for `1day`) and
the range picker cuts its window client-side (doc 09 §1). The other values in
the allowlist stay valid; nothing this app ships sends them any more. It costs
no extra upstream call — the Worker fetches its deep series whatever the
window — and Twelve Data charges per call, not per candle.

**`/api/fx/history` has no KV entry of its own**, and that is a decision rather
than an omission. Its inputs are the `fx:snap:` pile, which is permanent, so a
cache over them would save only fan-out — while costing four coupled edits (§4’s
table, `CACHE_POLICY`, `cacheKey`, and the drift test that parses this file).
It reads KV, cross-rates, and answers `HIT` with the `fx` family’s `max-age`;
there is no `MISS` it can produce. The edge absorbs the repeat-hit shape, which
here is every reader asking for the same pair and range.

## 4. KV cache TTLs (authoritative)

| Key prefix | TTL | Stale-serve window |
|------------|-----|--------------------|
| `wx:v1:*` | 600 s | 24 h |
| `aqi:v1:*` (bundled into wx payload) | 1800 s | 24 h |
| `geo:v1:<lang>:<q-norm>` | 24 h | 7 d |
| `fx:v1:USD` | 12 h (capped by upstream next-update) | 48 h |
| `fx:snap:<date>` | none (permanent) | — |
| `cr:tick:v1:<set>` | 30 s | 10 min |
| `cr:kl:v1:<sym>:<int>` | 300 s (sub-hourly) / 900 s (1h and coarser) | 6 h |
| `st:q:v1:<sym>` | 90 s | 12 h |
| `st:qs:v1:<set>` (client only) | 90 s | 12 h |
| `st:se:v1:<sym>:15min` | 900 s | 24 h |
| `st:se:v1:<sym>:1day` | 21600 s (6 h) | 7 d |
| `st:sr:v1:<q-norm>` | 24 h | 7 d |
| `rss:v1:<url-hash>` | 1200 s | 24 h |

**Two stock rows arrived with Week 5b (2026-09-23).**

- **`st:qs:v1:<set>`** is the *client's* entry for a watchlist's stock set. It
  is one swr subscription and one request per refresh, the way
  `cr:tick:v1:<set>` is for crypto. The Worker does not cache the set: §3 asks
  it to cache **each symbol** under `st:q:v1:<sym>`, so two watchlists sharing
  AAPL share its quote. The client row therefore carries the per-symbol
  policy.
- **`st:sr:v1:<q-norm>`** is symbol search, cached like geocoding. A company's
  ticker changes rarely, and every lookup is a Finnhub call.

Implementation: KV `put(key, body, { expirationTtl: ttl + staleWindow })`
with `cachedAt` inside the value; freshness = `now - cachedAt <= ttl`;
between ttl and staleWindow the value is served **only** when upstream
fails (`stale: true` in meta) or the breaker is open.

**The stale window is enforced on the read, not only by KV's expiry** (added
2026-09-01). `writeCache` does set `expirationTtl` to ttl + stale, so in
practice KV had usually removed the entry first — which is what made relying on
it the wrong call: KV expiry is best-effort and not instant, an entry written by
an older build with a longer window is not covered by it at all, and the window
above is a promise about how old a reading may be before it stops being one.
`readCache` now answers `MISS` past it. Families with `staleMs: null` are
exempt, because `fx:snap:` *is* the currency history and dropping one would be
dropping data rather than dropping a derivable.

Found by the crypto degradation-ladder suite asking a 30 s/10 min family for an
hour-old entry and being handed it — a case no endpoint suite had, because each
of those seeds an entry inside the window it means to test.

A value may carry its own `freshUntil`, and then that instant wins over the
row above. It exists for the one row whose TTL is not ours to set — `fx:v1:USD`
is capped by `time_next_update_unix` (doc 10 §3), and a table upstream has
already replaced is not fresh however recently we fetched it. Two rules make it
safe: **the cap may only ever shorten** (this table stays the ceiling, so an
upstream claiming a nine-day gap does not get one), and **a cap already in the
past is ignored** rather than honoured, because an entry born stale refetches on
the very next request and one bad field upstream would become a fetch per
request. Written into the value rather than passed to the write, because the
read that has to respect it happens on a later request that never saw the cap.
Absent on every entry written before 2026-08-31 and on every family with no
upstream opinion, which is what makes it a non-event for `wx` and `geo`.

**The klines row's two TTLs are split at the hour** (clarified 2026-09-01).
It read "300 s (5m int) / 900 s (1h+)", which leaves `15m` — an interval doc
10 §4 lists — in the gap between the two. `shared-constants.ts` had resolved it
in a comment ("sub-hourly" / "1h and coarser") and this table had not, and the
drift test cannot see the difference: it strips parentheticals as commentary,
so both spellings parse to the same two durations.

**`<set>` is the canonical symbol list, not a hash of it** (settled 2026-09-01;
this row said `<set-hash>`). `shared-constants.ts` exports `symbolSetKey`, which
uppercases, de-duplicates and **sorts** before joining — and that part is
load-bearing whichever spelling wins, because two watchlists holding the same
coins in a different order are the same question and would otherwise occupy two
entries, halving the hit rate and doubling the calls upstream with nothing to
say so.

What a hash would add is brevity; what it would cost is a collision serving one
watchlist's prices under another watchlist's key, which is wrong data rather
than a miss. A cryptographic digest avoids that and is `async` in both runtimes,
which would make every `cacheKey` call site async for a cache key. doc 09 §1
caps a watchlist at twelve and doc 10 §5 caps a symbol at twelve characters, so
the literal set is at most 155 bytes against KV's 512 — there is nothing to buy.
It also means `wrangler kv key list` shows what an entry *is*.

KV consistency note: KV is eventually consistent (~60 s cross-PoP). For
cache purposes that's fine — worst case a few PoPs refetch. Never use KV
for anything requiring strict counters (see §6 for how the soft limiter
copes).

## 5. Stock quota model (Twelve Data 800/day)

- Steady-state cost per warm symbol-interval: 15 min TTL → ≤ 96 calls/day;
  1 day TTL 6 h → ≤ 4 calls/day.
- Popularity concentration: watchlists share KV — 500 DAU with the default
  4-symbol list costs the same as 1 user. Long-tail risk is many unique
  symbols; mitigations: per-instance watchlist cap 12, series fetched only
  when a detail view opens (not for tiles), and the breaker below.
- Budget guard: maintain `st:budget:<utc-date>` counter (KV, best-effort).
  At ≥ 720 (90%), stop MISS fetches for *intraday* (serve stale, else
  `QUOTA_EXHAUSTED` — Stooq, the old fallback, is gone; doc 10 §5);
  daily series keep going to 780; at 780 full stop until UTC reset.
  ~~Also trust upstream truth: parse `api-credits-left` header each response
  and fold into the same guard (min of both signals).~~ **Withdrawn
  2026-09-23:** that header counts the current *minute*, not the day. Folded in
  as written, one call's "7 left" read as "793 spent" and stopped every series
  until UTC midnight — measured on production the day stocks shipped
  (`budget: 793 of 800`). No response header carries a daily figure, so the
  counter above is the only one, and the 20 credits between 780 and 800 are
  the slack for its under-counting.
- **The minute is a second limit** (added 2026-09-23): Basic allows eight
  credits a minute. A response whose `api-credits-left` is 0, or a 429 that
  does not say "for the day", marks the minute in KV (`st:minute:<epoch-min>`,
  60 s TTL). Until it turns, the route answers stale or `RATE_LIMITED` with a
  `retry-after` of the seconds left, and spends nothing on a refusal it can
  predict. The minute trips no breaker and touches no budget: it says nothing
  about upstream's health or the day.

## 6. Circuit breaker (per upstream)

State in KV `brk:<upstream>` `{state: closed|open, openedAt, reason}`.
- Open on: 3 consecutive 5xx/timeouts, any 429/418, or quota guard trip —
  **except Twelve Data's per-minute 429** (2026-09-23), which is §5's minute
  mark rather than a breaker failure. Until then every Twelve Data 429 was a
  quota trip, so a ninth request inside one minute would have stopped charts
  until midnight.
- While open (cool-down 120 s; quota trips → until UTC midnight): skip
  upstream, serve stale, else `QUOTA_EXHAUSTED`/`UPSTREAM_DOWN` envelope.
- Half-open: first request after cool-down probes upstream; success closes.
Best-effort across PoPs (KV consistency) — acceptable: the goal is bulk
back-off, not perfection.

## 7. Rate limiting (defense in depth)

1. **Cloudflare zone rule (free plan, 1 rule):** path `/api/*`,
   60 req / 1 min per IP → block 60 s. Coarse hard wall.
2. **In-Worker soft limiter:** KV counter `rl:<ipHash>:<bucket10s>`
   (ipHash = SHA-256(ip + daily rotating salt), TTL 60 s) — over 30/10 s →
   429 + `retry-after`. Eventual consistency makes it approximate; that's
   fine (the zone rule is the wall). No raw IP is ever stored.

   **It writes to KV on every request**, which is the highest-volume write in
   the app by a wide margin — higher than the cache, because a cache write
   happens only on a MISS. On Workers **Free** that alone would exceed the
   1 000 writes/day allowance at roughly a thousand API requests; the account
   is on **Paid** (recorded in `wrangler.jsonc`, confirmed 2026-08-30), so it
   is a metered cost rather than a ceiling. Worth revisiting if the write
   volume ever shows up on a bill: a counter that only writes when a bucket is
   near its limit would cost a fraction of this and lose little, since the
   zone rule is the actual wall.
3. **Client behavior:** on 429 respect `retry-after`, exponential backoff
   (max 5 min), single global toast not per-widget spam (doc 17 §5).

   **Wired 2026-09-01.** The toast half landed in Week 4b; the other two were
   description without code until `core/scheduler.ts` learned to take its next
   due time from the backoff rather than from the cadence, and to read a
   server-named `retryAfterS` off the rejection `swr` already throws. doc 04 §2
   carries the reasoning and doc 17 §5 the policy. The 5 min here is the
   *curve's* ceiling — a delay the server names is honoured in full, which is
   what lets §6's quota trip hold to UTC midnight.

## 8. Validation & limits

- Query params validated first (hand validators, shared with client types).
  Coordinate rounding enforced server-side too (privacy + cache keying).
- Upstream fetches: 8 s timeout via `AbortSignal.timeout`, 1 MB response
  cap (`content-length` check + streamed count), gzip accepted.
- `waitUntil()` used for KV writes and fx snapshots so responses don't wait
  on cache persistence.

## 9. Observability (privacy-respecting)

No third-party telemetry in the Worker. (The browser loads one Cloudflare
analytics beacon since 2026-09-23 — page views, not app telemetry; doc 16 §3.)
Rely on Cloudflare's built-in Workers metrics
(requests, errors, CPU) + `wrangler tail` during incidents. A dev-only
`GET /api/_health` returns breaker states and today's stock-budget counter.

**`/api/_health`, as built (2026-09-23).** It answers only
`Authorization: Bearer <DEV_DASH_TOKEN>`. This section said "query secret"
until then, and a query string is the wrong carrier on two counts: the URL
lands in the Worker's invocation logs (`wrangler.jsonc` `observability`), and
in browser history, where a header does not.

The rules that make it safe on a public origin, each with a test in
`routes/api/_health/server.test.ts`:

- **A missing, wrong, or unconfigured token gets a bare `404`**, not a `401`,
  so asking does not reveal the endpoint.
- **An unset or short secret switches it off.** Below 32 characters it is off,
  because `.dev.vars.example` ships the name empty and an empty secret must
  never match an empty bearer.
- **The comparison is constant-time** (`_lib/dev-token.ts`).
- **Every answer is `no-store`**, the refusal included. The adapter's worker
  replays any cacheable GET from `caches.default` *before* hooks or handlers
  run, so a `public` report would reach the next caller whatever they sent.

What it reports:

- every upstream in `_lib/breaker.ts`'s `UPSTREAMS`, with state, the verdict
  the clock gives now, failures, and the last reason. That list is a typed
  union the breaker functions accept, so an endpoint naming a new upstream
  does not compile until the report can see it;
- today's Twelve Data spend against §5's tiers;
- whether each upstream key is set (never its value);
- the Turnstile gate's state (`on`, `off`, or `misconfigured` for a secret
  with no sitekey) and the `turnstile` breaker, which is where siteverify
  outages are recorded (doc 15 §3);
- the build;
- `cf.colo`, the Cloudflare location that answered.

`/api/_health` and `/api/verify` are the gate's two exemptions. The operator's
bearer also passes the gate on every other route, so curl spot checks and the
S3 harness do not need a challenge.

A reason is masked before it leaves: `name=value` pairs that sound secret and
any 32-plus-character key-shaped run. It is also cut to 200 characters. Since
the same date, a non-2xx reason carries the first 160 characters of the error
body (`_lib/upstream.ts`). A bare `upstream 451` could not tell 5a's Binance
failure from a malformed request; the body can.

**The secrets are typed by the generator, from the committed example**
(2026-09-23). Secrets are not declared in `wrangler.jsonc` — they are set with
`wrangler secret put` — and by default `wrangler types` learns their names from
`.dev.vars`, which is gitignored. A checkout with one therefore generated a
different `worker-configuration.d.ts` from CI's, and `wrangler types --check`
inside `pnpm lint` failed on whichever side had not generated it. Doc 13 §10
recorded that as the reason the diagnostics breaker rows were deferred out of
Week 3; it blocked `/api/stock/*` just as hard.

**The first answer, 2026-09-01, only moved the failure.** It typed the three
secrets by hand in `src/worker-env.d.ts` and left the generated file alone,
which kept the *committed* file stable — but `--check` still read the
developer's `.dev.vars`, so the claim here that it "stays green on both sides"
held only while nobody had one, and Week 5b is the week that needs one.
Measured before it bit: `wrangler types --check --env-file .dev.vars.example`
reported the committed file out of date.

`pnpm gen` now runs `wrangler types --env-file .dev.vars.example`, and `build`
and `check` go through it. An explicit env file **replaces** the default lookup
rather than adding to it, so the generator reads the committed names — which
carry no values — on every machine and in CI, and a developer's `.dev.vars` is
never consulted. Verified 2026-09-23 with a `.dev.vars` carrying real-looking
values and an extra local-only name: `--check` stayed green and a regenerate
produced no diff. `src/worker-env.d.ts` is gone. Adding a secret is now "name
it in `.dev.vars.example`, then `pnpm gen`".

Each is typed `string`. The optional chain on `platform?` already makes a read
`string | undefined` at the call site, so the "deployed without `wrangler
secret put`" branch stays reachable and is guarded the way a missing KV binding
is.
