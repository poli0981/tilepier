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
- **Edge cases:** geocode zero-results state; geolocation denied ->
  `permission-needed` card with search fallback.

**Built 2026-08-30 (the tile).** Four things this section did not say, recorded
where the next reader will look for them:

- **The sparkline is gated on `h >= 3`, not on the density tier.** The tier is
  `L` only at `w>=4 || h>=4` (doc 13 §3), so reaching for it would drop the
  sparkline on every 3x3 and 2x3 tile - a whole size band rendering as if it
  were the 3x2 default. Tier `S` is unreachable here at all, since `sizes.min`
  is 2x2; named rather than skipped, per doc 06 §3's single-widget N/A rule.
- **Seven WMO glyphs ship, not sixteen** (doc 12 §6). Week 4 came in at four
  times its budget and the cut was taken in depth rather than in widgets, per
  doc 23's slip policy. The full code range still maps - `wmoGlyph` folds
  drizzle into rain, grains into snow and hail into thunder - so nothing
  upstream sends renders as `unknown`. Widening the set is a change to
  `ui/icons/wmo.ts` alone.
- **The stale badge is in the tile body, not the host header** (doc 13 §7 puts
  it in the header). See doc 13 §3 for why, and for what it would take to move.
- **The detail ships without the AQI gauge and the astronomy card**
  (2026-08-30) — depth cuts taken when Week 4 measured at four times its
  budget, per doc 23's slip policy. **The cloud band does ship**: it was held
  back one commit because `cloud_cover` was not among the hourly columns
  `/api/weather` requested, and adding it is a `routes/api` change that wanted
  to ride with the air-quality timezone bug in the same file (doc 10 §2). Both
  landed together.

  All three series are on the 24 h chart, and their **order is a decision**:
  temperature, then precipitation chance, then the cloud band. Series order is
  what assigns doc 12 §4.3's ramp, so it is the only place it can be said that
  the temperature is the reading the beacon marks (doc 12 §4.1) and the band is
  the quietest thing on the chart. Getting it backwards is invisible to every
  other assertion about the option.
- **`empty` is the first-run state, and it does not fetch.** doc 13 §9 seeds
  this tile with no place on purpose, so the subscription lives in an inner
  component that only mounts once a place exists - otherwise every reader would
  issue an Open-Meteo request on first load for a tile they had not yet pointed
  anywhere.

**The picker (2026-08-30).** This section puts the place picker in the detail.
It ships **in the tile**, as the `empty` state itself, and the reason is doc 13
§9: the first-run deck seeds a weather tile with no place, so a picker behind a
detail panel would make the one tile a new reader is most likely to try the one
that does nothing until they go looking. The detail will still carry it when it
lands, for changing a place rather than choosing the first one.

Three more decisions worth having written down:

- **Search does not go through `swr()`.** That primitive is keyed on a data
  identity the deck keeps looking at; a search box makes a new key per
  keystroke, each wanted once. Routing it through `swr` would fill the dedupe
  map and the Dexie `apiCache` with a row for every prefix on the way to the
  word the reader meant. `/api/geocode` already caches for 24 h (doc 11 §4),
  which is the caching that matters. Debounce is 400 ms, chosen against doc 11
  §7's 30-per-10 s limiter so continuous typing cannot trip the gate the
  forecast refresh also draws on.
- **A geolocated place is stored with a blank `name`.** doc 10 §6 is forward
  search only, so there is no reverse lookup to give it a real one, and a
  translated label would freeze into `tp.layout.v1` at whichever locale it was
  picked in and be wrong after a locale switch. The tile renders
  `widget.weather.my_location` from the live catalogue when the name is empty.
- **The rounding happens inside `geolocate.ts`**, in the same function that
  receives the fix, and not at the call site. doc 16 §3 and doc 15 §7 require 2
  dp *before the coordinate leaves the device*, and the Worker re-rounds on
  arrival - so a precise coordinate would produce a byte-identical response and
  the violation would be invisible from the outside. Both the node test and the
  component test were run against an unrounded build first.

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

### The one-row tile — one deviation, added 2026-08-30

The tile above is the h ≥ 2 tile. At **h = 1 it is the line and nothing else**:
no citation, no lunar footer, no keep, no copy, and the line ellipsised on one
row. Dropping the lunar footer is the deviation from the paragraph above — it is
the QuoteAtlas tie-in and it is genuinely gone at that size. The detail keeps
all four, and a one-row tile is one press from it.

The arithmetic is why. At `cellHeight: 72` (doc 06 §5.4) a one-row tile is 72 px
tall, and the 28 px header, the 1 px borders and the body's own bottom padding
leave the widget 34. The footer was 21 of those and the gap above it 6, so the
line got a 7 px slot for a 19.5 px line — it was not ellipsised, it was **cut
through the middle of the glyphs**, top and bottom. This is pre-existing rather
than a regression: the earlier grid-margin correction gave every one-row tile a
few pixels back, which was enough to make the clock legible at 2x1 and only
enough to move quote from unreadable to badly readable. The exact figures shift
with the row geometry; the sign of the subtraction does not.

Two things about the shape of the fix are worth keeping:

1. **It keys off `size.h <= 1`, not off `size.tier === 'S'`.** doc 13 §3's tier
   S is `w <= 2 && h <= 1`, so a 3x1 tile is tier **M** and has exactly the same
   34 px to work with as a 2x1 one. Tier is a density signal with the width
   mixed into it, and the thing being solved here is purely vertical.
   `TpClockWidget` splits the same decision both ways — its date line is behind
   `size.tier !== 'S'` and its zone rows behind `size.h >= 2` — and only the
   second is right: measured at 3x1 it renders the date line into 34 px and
   clips its own hero digits by 4 px. Tracked separately; the same reading of
   doc 13 §3 applies.
2. **The loading skeleton is one bar at h = 1, not three.** Three are 30 px of
   the 34, i.e. a loading state that overflows the ready state it stands in for.

`sizes.min` stays `2x1` — one row is an allowed size, and now a designed one.
It would not matter much if it changed: `toGridStackWidget` does not pass the
manifest's min/max to gridstack, so every tile can be dragged to one row today
regardless of what its manifest says (tracked separately).

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
