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
`{ id: crypto.randomUUID(), message: generic }`, log full detail to console
(→ ring buffer client-side), show the id on the 500 page so a bug report can
correlate. (Was `nanoid()`; nanoid is not a dependency and is not in doc 02's
locked stack — see doc 05 §2. `src/hooks.server.ts` already shipped the
`randomUUID` form.)

`+error.svelte` is a single file at the route root, outside the `(app)` group,
branching on `page.status` — an error page has to render even when the legal
gate has not been accepted.

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
- **Resolved 2026-08-10 (spike S5): the fallback is what ships.**
  vite-plugin-pwa does fight adapter-cloudflare. `@vite-pwa/sveltekit` builds
  its precache manifest from SvelteKit's internal layout (`client/…`,
  `prerendered/pages/…`), which adapter-cloudflare flattens — every entry 404s,
  install fails, and `serviceWorker.ready` hangs silently. A
  `manifestTransforms` rewrite fixes that, but the Workbox runtime then failed
  to execute inside the worker and the spike's box ran out.

  `src/service-worker.ts` implements the three behaviours above directly, using
  `$service-worker`'s `build` / `files` / `prerendered` — the URLs SvelteKit
  actually serves, which removes the path-translation problem at the root. It
  is ~110 lines and 1.1 KB gz, against a 15 KB Workbox runtime. Registration
  and the update prompt live in `src/lib/core/pwa.svelte.ts`; the toast is
  `TpUpdateToast`. `e2e/s5-pwa.e2e.ts` asserts all four pass criteria.

## 3. Offline degradation contract (per widget class)

| Class | Offline behavior |
|-------|------------------|
| Pure-client (tier 1, and `quote`) | Fully functional |
| Cached-data (weather, fx, markets, rss) | Last Dexie payload + stale badge; refresh suppressed until `online` |
| Search-dependent empty states (map search, geocode, symbol add) | Offline card: "cần mạng để tìm kiếm" |
| Map tiles | Browser-cached tiles render; new tiles gray grid + offline chip |
| Music/media (FSA/blob) | Fully functional (files are local) |

`quote` moved rows on 2026-08-28, when it was built. Its dataset is bundled
(doc 08 §3) so there is nothing to go stale and nothing to suppress: offline it
is fully functional, which is the whole point of computing the daily pick from
the date rather than fetching it. doc 06 §3 carries the same correction.

`stores/online.svelte.ts`: `navigator.onLine` + `online/offline` events +
a fetch-failure heuristic (2 consecutive TypeErrors → treat offline even
if onLine lies) feeding the top-bar chip (doc 13 §7). The `.svelte.ts` infix is
required — it holds `$state`, and Svelte 5 needs the infix outside components.
`swr()` reports every fetch outcome into it, and the scheduler subscribes to it
rather than to the raw `online` event, so one module owns the definition
(doc 04 §3).

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
