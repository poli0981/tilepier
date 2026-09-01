# 11 · Worker Proxy (`/api/*`)

## 1. Principles

1. Stateless, anonymous, boring. No auth, no cookies, no user IDs, no
   persisted logs (doc 16 §3).
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
{ "ok": false, "error": { "code": "UPSTREAM_DOWN" | "RATE_LIMITED" | "BAD_REQUEST" | "QUOTA_EXHAUSTED", "retryAfterS": 30 } }
```
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
| `GET /api/crypto/klines` | symbol, interval, limit≤500 | Binance klines |
| `GET /api/stock/quote` | symbols (≤12, fanned ≤12 Finnhub calls, cached individually) | Finnhub |
| `GET /api/stock/series` | symbol, interval(15min\|1day), range | Twelve Data → Stooq |
| `GET /api/stock/search` | q | Finnhub search |
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
| `cr:kl:v1:<sym>:<int>` | 300 s (5m int) / 900 s (1h+) | 6 h |
| `st:q:v1:<sym>` | 90 s | 12 h |
| `st:se:v1:<sym>:15min` | 900 s | 24 h |
| `st:se:v1:<sym>:1day` | 21600 s (6 h) | 7 d |
| `rss:v1:<url-hash>` | 1200 s | 24 h |

Implementation: KV `put(key, body, { expirationTtl: ttl + staleWindow })`
with `cachedAt` inside the value; freshness = `now - cachedAt <= ttl`;
between ttl and staleWindow the value is served **only** when upstream
fails (`stale: true` in meta) or the breaker is open.

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
  At ≥ 720 (90%), stop MISS fetches for *intraday* (serve stale/Stooq);
  daily series keep going to 780; at 780 full stop until UTC reset. Also
  trust upstream truth: parse `api-credits-left` header each response and
  fold into the same guard (min of both signals).

## 6. Circuit breaker (per upstream)

State in KV `brk:<upstream>` `{state: closed|open, openedAt, reason}`.
- Open on: 3 consecutive 5xx/timeouts, any 429/418, or quota guard trip.
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

No third-party telemetry. Rely on Cloudflare's built-in Workers metrics
(requests, errors, CPU) + `wrangler tail` during incidents. A dev-only
`GET /api/_health` returns breaker states and today's stock-budget counter
— gated by `env.DEV_DASH_TOKEN` query secret; absent in docs/UI.

**The three secrets are typed by hand in `src/worker-env.d.ts`** (2026-09-01),
and that file exists because `wrangler types` cannot produce them. Secrets are
not declared in `wrangler.jsonc` — they are set with `wrangler secret put` — so
the generator learns their names from `.dev.vars`, which is gitignored. The
committed `worker-configuration.d.ts` would then differ between a checkout that
has one and CI, which does not, and `wrangler types --check` inside `pnpm lint`
would fail on whichever side it ran. Doc 13 §10 recorded that as the reason the
diagnostics breaker rows were deferred out of Week 3; it blocked `/api/stock/*`
just as hard, which is why Week 5 settles it first.

The mechanism is declaration merging, not a second generator: `interface Env` is
global in the generated file, so a global `.d.ts` adds members to it and leaves
the generated file byte-identical. `src/fsa.d.ts` does the same thing to
`FileSystemHandle`. Typed `string` rather than `string | undefined` — the
optional chain on `platform?` already makes each read `string | undefined` at
the call site, so the "deployed without `wrangler secret put`" branch stays
reachable and is guarded the way a missing KV binding is.
