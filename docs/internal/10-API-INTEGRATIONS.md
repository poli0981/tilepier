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
  wind_speed_10m,wind_direction_10m,relative_humidity_2m,uv_index,surface_pressure
  &daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,
  precipitation_probability_max&timezone=auto&forecast_days=7`
- Air quality: `https://air-quality-api.open-meteo.com/v1/air-quality`
  (`european_aqi`, pm2_5, pm10, o3, no2).
- Geocoding (fallback only): `https://geocoding-api.open-meteo.com/v1/search`.
- Normalize: Worker maps to `TpWeatherPayload` (our shape) — client never
  sees raw upstream shape (schema-version isolation, doc 04 §5).
- Failure: 4xx (bad coords) → 400 to client; 5xx/timeout → stale-serve.

## 3. FX — rates + self-accumulated history

- Rates: `GET https://open.er-api.com/v6/latest/USD` → single base; Worker
  computes cross rates for any pair from the USD table (their open endpoint
  is one-base-per-call; one cached call covers all pairs).
- Upstream updates daily; `time_next_update_unix` honored: KV TTL = min(12 h,
  time-to-next-update + 5 min).
- **History (the VND problem):** no keyless API provides VND history →
  snapshot-on-read: first `/api/fx` request each UTC day also writes
  `fx:snap:YYYY-MM-DD` (USD table, permanent — no KV TTL). `/api/fx/history
  ?pair=USD-VND&days=90` assembles the series from snapshots. Client mirrors
  into Dexie `fxHistory` so the chart works offline. Storage cost:
  ~5 KB/day → trivial. Gaps (zero traffic that day) are legal; chart uses
  time axis, not index axis.
- Attribution string is part of the normalized payload so the UI can't
  forget it.

## 4. Binance (crypto)

- `GET /api/v3/ticker/24hr?symbols=[...]` for tile quotes (one batched call
  for the whole watchlist crypto subset).
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
