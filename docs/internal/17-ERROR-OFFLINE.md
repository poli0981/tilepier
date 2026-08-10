# 17 · Errors & Offline

## 1. Error-page matrix

| Condition | Who renders | Page/behavior |
|-----------|------------|---------------|
| 404 route | SvelteKit `+error.svelte` | Custom page: tide-gauge illustration, "trang này chưa cập bến", link home + search? (no search — just home) |
| 500 app error | `+error.svelte` (via `handleError` hook) | Custom page + "báo lỗi" button that opens the bug-report flow with the error pre-attached (doc 18 §4) |
| API 4xx/5xx (`/api/*`) | JSON envelope only (doc 11 §2) | Widgets render inline error/stale states — **never** full-page |
| 429 (zone rule or soft limiter) | JSON + `retry-after` | Global toast + per-widget backoff (§5) |
| Cloudflare edge errors (challenge, 52x) | CF default pages | Accepted: zone-level Custom Error Rules require a paid zone plan; not worth $20+/mo for edge-error cosmetics. Documented limitation. |
| No internet | Service worker | `/offline` fallback for navigations; widgets degrade in place (§3) |

`handleError` (server + client hooks): normalize to
`{ id: nanoid(), message: generic }`, log full detail to console (→ ring
buffer client-side), show the id on the 500 page so a bug report can
correlate.

## 2. PWA / Service worker (Spike S5 governs mechanism)

- Precache: app shell (entry, layout, fonts, icon sprite, `/offline`).
- Runtime: **network-first for navigations** with offline fallback;
  hashed immutable assets cache-first (they're content-hashed);
  `/api/*` **never** SW-cached (the client already has Dexie apiCache —
  double-caching creates staleness confusion).
- Update flow: SW `waiting` → quiet toast "phiên bản mới — tải lại"
  (skipWaiting only on user action; never reload under the user).
- Install: standard manifest (name, icons incl. maskable, theme colors both
  schemes); no install nagging — browser affordance only.
- If vite-plugin-pwa fights adapter-cloudflare (S5 fail), fall back to a
  ~80-line hand-rolled SW registered from the layout: same three behaviors,
  nothing more.

## 3. Offline degradation contract (per widget class)

| Class | Offline behavior |
|-------|------------------|
| Pure-client (tier 1) | Fully functional |
| Cached-data (weather, fx, markets, rss, quote) | Last Dexie payload + stale badge; refresh suppressed until `online` |
| Search-dependent empty states (map search, geocode, symbol add) | Offline card: "cần mạng để tìm kiếm" |
| Map tiles | Browser-cached tiles render; new tiles gray grid + offline chip |
| Music/media (FSA/blob) | Fully functional (files are local) |

`stores/online.ts`: `navigator.onLine` + `online/offline` events +
a fetch-failure heuristic (2 consecutive TypeErrors → treat offline even
if onLine lies) feeding the top-bar chip (doc 13 §7).

## 4. Client fetch-error taxonomy (in `swr.ts`)

- `TypeError` (network) → offline path.
- `ok:false` envelope → map `code` → state: `RATE_LIMITED`→backoff,
  `QUOTA_EXHAUSTED`→stale+quota badge tooltip, `UPSTREAM_DOWN`→stale-error,
  `BAD_REQUEST`→widget bug: log loudly, show inline error (don't retry).
- Malformed JSON → treat as `UPSTREAM_DOWN`, log with body snippet (1 KB).

## 5. Backoff policy (client)

Per data key: on 429/`retryAfterS` respect server value; else exponential
1→2→4→8… capped 300 s with ±20 % jitter; reset on success. One global
toast per 60 s max for rate-limit events regardless of widget count
(coordinator in `swr.ts`). Scheduler entries in backoff are skipped, not
removed.

## 6. Crash containment

Each `TpWidgetHost` wraps its widget with `<svelte:boundary>` (Svelte 5
error boundaries): a widget that throws renders a tile-local crash card
("widget gặp lỗi — thử lại / gỡ") with the error pushed to the ring
buffer; the rest of the deck keeps running. Boundary reset re-mounts the
widget fresh.
