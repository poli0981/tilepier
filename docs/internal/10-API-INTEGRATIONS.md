# 10 · External API Integrations

Authoritative reference for every upstream. All accessed **server-side from
the Worker** except OpenFreeMap tiles (§6). Attribution obligations roll up
into doc 16 §5 and the in-app licenses page.

## 1. Summary table

| Upstream | Auth | Free limits (verified 2026-07) | Used for | Attribution |
|----------|------|-------------------------------|----------|-------------|
| Open-Meteo (forecast, air-quality, geocoding) | none | fair-use, non-commercial free tier | weather widget | required: "Weather data by Open-Meteo" + link (data CC BY 4.0) |
| open.er-api.com (ExchangeRate-API open endpoint) | none | daily-updated rates, ~160 currencies incl. VND | currency rates | required: link to exchangerate-api.com per their terms |
| Binance public REST | none | generous IP-based weight limits; `/klines`, `/ticker/24hr` | crypto | ToS: display use OK; no redistribution claims |
| Finnhub | API key (free) | 60 calls/min; `/quote`, `/search` OK; **`/stock/candle` = 403 on free** | US stock quotes, symbol search | per ToS; show "data provided by Finnhub" in detail footer |
| Twelve Data | API key (free "Basic") | **8 credits/min, 800/day**, resets 00:00 UTC; `/time_series` = 1 credit/symbol; US equities incl. 30+ yr EOD + intraday | US stock series | per ToS footer note |
| Stooq CSV | none | keyless EOD daily CSV | stock series fallback | courtesy link in licenses page |
| Photon (komoot) | none | fair-use | geocoding primary | "Search by Photon/komoot, data © OSM contributors" |
| Nominatim (OSM) | none | **max 1 req/s, mandatory identifying UA/Referer**, caching required | geocoding fallback | ODbL attribution |
| OpenFreeMap tiles | none | free, no key, no hard limits | map tiles/styles | © OpenStreetMap contributors (ODbL) on-map |

Env keys: `FINNHUB_KEY`, `TWELVEDATA_KEY` (Worker secrets; never shipped to
the client; grep-guard in CI, doc 21 §5).

## 2. Open-Meteo

- Forecast: `GET https://api.open-meteo.com/v1/forecast?latitude&longitude
  &hourly=temperature_2m,precipitation_probability,precipitation,weather_code,
  wind_speed_10m,wind_direction_10m,relative_humidity_2m,uv_index,surface_pressure,
  cloud_cover
  &daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,
  precipitation_probability_max&timezone=auto&forecast_days=7`
- Air quality: `https://air-quality-api.open-meteo.com/v1/air-quality`
  (`european_aqi`, pm2_5, pm10, o3, no2), **`&timezone=auto`**.

  `cloud_cover` joined the hourly list on 2026-08-30 for doc 08 §1's cloud
  band; it is the tenth column and costs no extra call.

  **The air-quality call had no `timezone` parameter at all until the same
  day**, which is worse than it sounds: Open-Meteo then answers in GMT, and
  `normalizeAir` took `hourly[0]` and called it "now". For Hanoi that is 07:00
  local; for a place west of GMT the series starts on the previous local day.
  The reading was wrong by the whole offset everywhere except Britain in
  winter. Nothing rendered it yet — the AQI gauge is a Week 4 cut — so nothing
  complained, and it would have shipped into whichever week built the gauge.
  The parameter alone is not the fix either, because index 0 is then local
  midnight; `normalizeAir` takes the place's zone and finds the matching hour,
  falling back to index 0 so a nice-to-have still degrades rather than
  failing.
- Geocoding (fallback only): `https://geocoding-api.open-meteo.com/v1/search`.
- Normalize: Worker maps to `TpWeatherPayload` (our shape) — client never
  sees raw upstream shape (schema-version isolation, doc 04 §5).
  **Built 2026-08-28.** It had not been: the endpoint shipped in Week 0 with
  `hourly` and `daily` passed straight through as `unknown`, which is the
  opposite of this line. `routes/api/_lib/normalize.ts` now turns the nine
  parallel arrays into rows — a reader had to index all nine in step to
  describe one hour — and **trims 168 hours to 48**, since doc 08 §1 asks for
  a 24-hour chart and a 12-hour sparkline and 48 covers either from any point
  in the day. The other 120 are five times the payload for a view that does
  not exist. Every field is read defensively: a missing column yields `NaN`
  rather than a zero, because 0 °C is a temperature and a gap is not.
- Failure: 4xx (bad coords) → 400 to client; 5xx/timeout → stale-serve.

## 3. FX — rates + self-accumulated history

- Rates: `GET https://open.er-api.com/v6/latest/USD` → single base. Their open
  endpoint is one-base-per-call, so doc 11 §3 gives `/api/fx` **no parameters
  at all** and one cached call covers every pair — which means **the client
  computes the cross rate**, `rates[to] / rates[from]`. (Corrected 2026-08-31:
  this said the Worker computed it, which the endpoint's own signature forbids.
  Sending a pair up would multiply one cache entry by 160².)
- Upstream updates daily; `time_next_update_unix` honored: KV TTL = min(12 h,
  time-to-next-update + 5 min). The cap is carried as `freshUntil` inside the
  cached value rather than passed to the write, and it may only ever shorten —
  doc 11 §4 has the mechanism and the two rules that keep it safe.
- **History (the VND problem):** no keyless API provides VND history →
  snapshot-on-read: the first `/api/fx` request after each upstream publication
  also writes `fx:snap:YYYY-MM-DD` (USD table, permanent — no KV TTL).
  **Keyed on the date upstream published, not on the Worker's clock**, which
  differ for the ten minutes between UTC midnight and ER-API's daily push; a
  snapshot filed under tomorrow's date in that window would be a wrong number
  in a store that has no expiry and is never rewritten. `/api/fx/history
  ?pair=USD-VND&days=90` assembles the series from snapshots. Client mirrors
  into Dexie `fxHistory` so the chart works offline — **driven by `/api/fx`'s
  own daily table rather than by the history response** (2026-08-31). `swr`
  already caches the history the reader has looked at; what the mirror adds is
  that one snapshot answers every pair and every range, so a reader who viewed
  USD→VND and then switches to USD→EUR offline still gets a chart. One `put` per
  published day on the tile's existing cadence, bounded at 400 rows (doc 05 §3). Storage cost:
  ~5 KB/day → trivial. Gaps (zero traffic that day) are legal; chart uses
  time axis, not index axis.
- **Yesterday travels with today.** `/api/fx` reads the previous publication's
  snapshot on a cache miss and returns it as `prevRates`/`prevDate` in the same
  payload, which is what powers doc 08 §2's 24 h change column across the whole
  table for one extra KV get. `/api/fx/history` stays the per-pair time series:
  wide-and-shallow and narrow-and-deep, and neither can cheaply do the other's
  job — covering 160 rows through the history endpoint would be 160 requests.
  On the day this deploys there is no previous snapshot, so both fields are
  `null` and the detail renders **no change column** rather than a column of
  zeros. A 0.00 % is a claim; an absent column is the truth.
- Attribution string is part of the normalized payload so the UI can't
  forget it.

## 4. Binance (crypto)

- `GET /api/v3/ticker/24hr?symbols=[...]` for tile quotes (one batched call
  for the whole watchlist crypto subset).

  **The batch is all-or-nothing, and doc 09 §1's edge cases are unreachable
  without knowing that** (found 2026-09-01, building the endpoint). One symbol
  Binance does not have makes the *whole* request a 400 — `-1121 Invalid
  symbol.` — so the morning a coin is delisted the entire tile goes down, every
  other row with it, and "delisted symbol → row error chip with a remove
  shortcut" cannot happen.

  `/api/crypto/ticker` therefore falls back to one call per symbol **on a 400
  and only on a 400**, filling the row that still fails with `null`. Bounded at
  twelve keyless requests, on the error path only, and the assembled answer
  caches under the same set key — so the split costs three requests per TTL
  rather than three per reader. A 429, a 418 or a 5xx is upstream refusing us or
  being down, and answering that by multiplying one request into twelve is the
  exact shape doc 11 §6's breaker exists to prevent.

  **Every number in a Binance row is a string.** `"62910.53"`, not `62910.53`;
  only `openTime` and `closeTime` arrive as numbers. A reader who assumes
  otherwise gets `NaN` through the whole payload and a tile of em dashes, with
  nothing thrown to say so.
- `GET /api/v3/klines?symbol=BTCUSDT&interval=5m|15m|1h|1d&limit=500` for
  candles. Map to `[t,o,h,l,c,v]` tuples.
- Keyless; per-IP weight limits are far above our cached usage. Handle 429
  (`Retry-After`) + 418 (IP ban semantics) by opening the breaker (doc 11 §6).
- Base host `api.binance.com`; if regionally blocked at the edge in future,
  mirror hosts are a config constant — do not hardcode inline.

## 5. Stocks — Finnhub + Twelve Data + Stooq

- Finnhub quote: `GET /api/v1/quote?symbol=AAPL` (fields c,d,dp,h,l,o,pc,t).
  Budget: 60/min is ample once cached 90 s.
- Finnhub search: `GET /api/v1/search?q=` → filter `type==='Common Stock'`,
  US exchanges first.
- Twelve Data series: `GET /time_series?symbol=AAPL&interval=15min|1day
  &outputsize=…&format=JSON`. 1 credit per symbol-call. Read
  `api-credits-used` / `api-credits-left` response headers into the breaker
  state (doc 11 §6). Daily quota 800, resets midnight UTC.
- Stooq fallback: `GET https://stooq.com/q/d/l/?s=aapl.us&i=d` (CSV,
  EOD daily). Parse server-side; mark payload `source:'stooq', eod:true`.
- Symbol namespace: client sends `{kind, symbol}`; Worker maps
  crypto→Binance, stock→Finnhub/TwelveData/Stooq. Uppercase-normalize,
  allowlist charset `^[A-Z0-9.\-]{1,12}$`.

## 6. Maps — OpenFreeMap + Photon/Nominatim

- Tiles/styles/glyphs/sprites from `tiles.openfreemap.org` — the **only**
  direct-from-browser third party; CSP `connect-src` allowlists exactly this
  host (doc 15 §2). Style variants: Liberty (light) + dark; pin both style
  JSON URLs as constants.
- Geocode via Worker: Photon `https://photon.komoot.io/api/?q=&limit=5&lang=`
  primary; Nominatim `https://nominatim.openstreetmap.org/search?format=jsonv2`
  fallback with mandatory `User-Agent: TilePier/<ver> (tilepier.win)`
  and KV caching (their policy **requires** caching; our 24 h TTL satisfies
  it). Normalize both to `{name, displayName, lat, lon, type}`.
- On-map attribution control must stay enabled (ODbL condition) — never
  hide it via CSS.

**Built 2026-08-28**, ahead of the map widget that will use it, because the
weather widget's place picker (doc 08 §1) needs it in Week 4. Photon leads and
Nominatim only sees what Photon could not answer — that ordering is the policy
compliance, not an optimisation. Two decisions worth recording:

- **A search that found nothing is cached.** It is an answer, and re-asking two
  volunteer-run services the same unanswerable question on every keystroke is
  exactly what their fair-use policies exist to prevent.
- **The cache key normalises case and whitespace but keeps diacritics.**
  `Hà Nội` and `  HÀ   NỘI  ` are the same search; `Hà Nội` and `Ha Noi` are not,
  because they are different questions upstream and folding them would make two
  searches share one answer.

## 7. RSS (arbitrary user feeds)

Not one upstream but a class: `GET /api/rss?url=<https-url>`. Constraints
live in doc 15 §5 (SSRF guard: https-only, DNS-rebind-safe fetch via
standard Worker fetch, 1 MB cap, 8 s timeout, content-type sniff, redirect
limit 3, per-feed KV cache). Parser: `fast-xml-parser` handling RSS 2.0 /
Atom / RDF; output normalized `{title, link, items:[{id,title,link,summary,
publishedAt,author?}], icon?}` with summaries pre-truncated to 2 KB.

## 8. Compliance checklist (gate for Week 8, doc 23)

- [ ] Open-Meteo link + CC BY 4.0 notice on licenses page and weather detail
- [ ] ER-API attribution link rendered wherever rates shown
- [ ] © OpenStreetMap contributors visible on every map render
- [ ] Photon/komoot credited on licenses page
- [ ] Finnhub / Twelve Data credit lines in markets detail footer
- [ ] "Not investment advice / data may be delayed" disclaimer in markets
- [ ] Nominatim UA string set and 24 h caching verified
- [ ] No API key present in any client bundle (CI grep, doc 21 §5)
