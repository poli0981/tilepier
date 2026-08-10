# 08 · Widget Specs — Tier 2 (proxied APIs)

All data via `/api/*` (doc 11). Client SWR TTLs listed per widget; Worker KV
TTLs are authoritative in doc 11 §4. Every widget here must exhibit correct
`stale` / `offline` / `stale-error` behavior (doc 06 §3).

## 1. `weather` — Weather · AQI · Astronomy

- **Source:** Open-Meteo forecast + air-quality + geocoding (doc 10 §2).
- **Tile:** place name, current temp (big), condition icon (internal icon
  set mapped from WMO weather codes — no emoji), hi/lo, precip probability
  chip; at h≥3 add a 12 h temp sparkline (inline SVG). Multi-instance:
  one tile per place.
- **Detail (ECharts):** 24 h combo chart (temp line + precip bars + cloud
  band), 7-day strip (icon, hi/lo bars), wind (speed + direction), humidity,
  UV, pressure; AQI gauge (European AQI) with pollutant breakdown; astronomy
  card: sunrise/sunset arc, moon phase (computed locally), day length.
- **Location:** default place picked at first add via search
  (`/api/geocode`); optional "use my location" → browser geolocation
  (`permissions: ['geolocation']`), coordinates rounded to 2 decimals before
  ever leaving the device (privacy, doc 16 §3).
- **Refresh:** scheduler 600 s; client ttl 600 s.
- **Edge cases:** geocode zero-results state; geolocation denied →
  `permission-needed` card with search fallback.

## 2. `currency` — Currency Converter (VND first-class)

- **Source:** open.er-api.com daily rates (has VND); history from
  self-accumulated KV snapshots (doc 10 §3).
- **Tile:** one editable pair (default USD→VND), big converted amount,
  inline amount input, rate line + as-of date, swap button.
- **Detail:** multi-row converter (base amount → n currencies, add/remove/
  reorder), rate table with 24 h change once ≥2 snapshots exist, and the
  history line chart (ECharts) for the selected pair over the accumulated
  window — chart shows honest empty state "history builds daily from launch"
  until ~14 snapshots exist.
- **Refresh:** 12 h client ttl (rates update daily upstream).
- **Rounding:** display rounding per currency minor units; VND has 0 decimals.
- **Edge cases:** unknown currency code in stored settings (upstream dropped
  it) → keep row, mark unavailable.

## 3. `quote` — Quote of the Day

- **Source:** bundled dataset reused from QuoteAtlas (CC0/owned entries
  only — re-verify per-entry licensing before bundling, doc 16 §5), shipped
  as a static JSON chunk; no network.
  (Kept in Tier 2 doc for historical ordering; it is effectively Tier 1.)
- **Tile:** quote + author, deterministic daily pick seeded from `dateKey`
  (all users see the same quote per day, offline-safe); lunar date footer
  when locale=vi (QuoteAtlas tie-in).
- **Detail:** browse by tag/author, search, favorite (stored in tile
  settings? → favorites are app data: Dexie table not needed; store id list
  in widget settings, cap 200), copy-as-text, share-quote-as-image
  (canvas render using design tokens) — stretch, cut-line if Week 4 tight.
- **Edge cases:** locale switch mid-day keeps the same quote id, swaps
  translation if the dataset has one.

## 4. `rss` — RSS / News Reader

- **Source:** `/api/rss?url=` — the Worker fetches, parses (fast-xml-parser
  on the server side), normalizes to a JSON feed shape, caches (doc 11 §4).
  CORS is the whole reason this is proxied; SSRF guards in doc 15 §5.
- **Tile:** merged reverse-chron list of the instance's feed set (1–10
  feeds), unread-style dot for items newer than last-opened watermark
  (stored per instance in settings), favicon per source
  (Worker-provided `icon` field when the feed declares one; no third-party
  favicon service).
- **Detail:** three-pane on wide (feeds / list / reader), stacked on
  narrow. Reader shows title, source, time, and the feed-provided
  summary/content sanitized through DOMPurify with a strict allowlist
  (p, a, lists, blockquote, code — **no `img` in v1**, per doc 15 §2/§4) —
  links open in new tab with `rel="noopener noreferrer"`. "Open original"
  is primary.
- **OPML:** import/export of the instance's feed list (small, high-value).
- **Refresh:** 1200 s.
- **Edge cases:** dead feed → per-feed error chip, others keep working;
  mixed-date formats (RFC822/ISO) normalized server-side; feeds without
  dates → order by fetch time with an "undated" tag.

## 5. `map` — Map & Places

- **Source:** MapLibre GL JS + OpenFreeMap vector tiles (direct, doc 10 §6);
  geocoding via `/api/geocode` (Photon primary, Nominatim fallback).
- **Tile:** static-feel mini map centered on home place (interactions
  disabled except click-to-open-detail); saved-places count chip.
- **Detail:** full interactive map — search box (debounced 400 ms ≥3 chars),
  result pins, save place (name editable → Dexie `savedPlaces`), saved list
  with fly-to, distance from home (haversine), coordinates copy,
  "open in OSM/Google Maps" external links, style toggle
  (OpenFreeMap Liberty/dark variant matching app theme).
- **No routing/directions in v1** (API cost + scope); external links cover it.
- **Perf:** maplibre chunk + style JSON loaded only on first map mount;
  tile requests are browser-cached; WebGL context released on detail close
  (`map.remove()`).
- **Edge cases:** WebGL unavailable → static fallback card with search +
  external links (feature-detect, don't crash); geocode rate-limit 429 →
  inline retry-after message.
