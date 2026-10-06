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

- **What is cached, and when** (rewritten in Week 8; this section had said
  three different things about it):
  - **Precached at install: the shell.** Everything in `static/` (fonts,
    `boot.js`, icons, the manifest), every prerendered page — `/offline`
    among them — and the hashed files that `/`, `/offline` and `/settings`
    preload, read from the copies just cached. About 400 KB gz. One
    prerendered page is left out: `/legal/licenses`, about 150 KB of licence
    text a first visit has no use for (doc 16 §5); offline it falls back to
    `/offline`, and once read online it is kept like any page.
  - **Kept as it is used:** any `/_app/immutable/` file the page fetches
    through the worker, cache-first, a `200` only (a `206` is `ok` too, and
    `cache.put` refuses it). MapLibre's modules and the music tag worker are
    in that path although `build` never lists them (corrected 2026-09-29).
  - **Handed over (KEEP):** what the page loaded before the worker controlled
    it — on a first visit, the grid and every tile on the deck. `pwa.svelte.ts`
    posts the page's resource-timing URLs once a worker is in control, and
    the worker keeps the same-origin hashed ones, from the HTTP cache.
  - **Fetched while idle:** the detail of every widget on the deck
    (`core/warm.ts`), once a worker controls the page, online, never under
    Save-Data, one at a time. So a detail never opened opens with no
    connection — the gap journey #4 found on 2026-08-28 and worked around.
  - **Carried forward:** a new version's install takes a hashed file it
    needs from the older version's cache when it is there; the same hash is
    the same bytes, so a deploy downloads what changed. Never for `static/`
    files or pages, whose contents change under the same URL.
- **Until Week 8 the precache was the whole build**: every tile and detail
  chunk and ECharts, 269 files and 883 KB gz on every visitor's first visit,
  for a deck that uses five widgets. `e2e/s5-pwa` now asserts an install
  caches no widget at all, and was red against the old worker with 32.
- **The one thing that now needs a connection: a widget this browser has
  never loaded, added from the drawer while offline.** Its tile is a card
  saying so, with a way to try again (`TpWidgetUnavailable`) — never a blank,
  and never the whole deck: the deck loaded its tiles in one `Promise.all`, so
  before Week 8 one chunk that failed to load would have left it empty.
- Runtime: **network-first for navigations** with offline fallback (the
  cached page, then `/offline`); `/api/*` **never** SW-cached (the client
  already has Dexie apiCache — double-caching creates staleness confusion).
- Update flow: SW `waiting` → quiet toast "phiên bản mới — tải lại"
  (skipWaiting only on user action; never reload under the user). Activation
  deletes every older cache (`e2e/s5-pwa`).
- Install: standard manifest (name, icons incl. maskable, theme colors both
  schemes); no install nagging — browser affordance only. **The icons are
  fetched by `e2e/s5-pwa`, not only declared** (2026-09-29).
  - The old check read the manifest's JSON and passed while both icons pointed
    at a missing file.
  - The 404 that file returned also carried SvelteKit's preload `Link` header,
    which Chromium applied to the page. That was Brave's "preloaded but not used"
    warning for the error page's CSS, and a 404 now drops the header
    (`hooks.server.ts`).
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
- `VERIFY_REQUIRED` (401, doc 15 §3) → `core/api.ts` drops the pass it sent,
  asks `passGate` for a fresh one and retries **once**. A second refusal
  surfaces like `UPSTREAM_DOWN` (stale-error / error, retryable). The one
  global notice is `TpBotCheck`'s ("this browser could not be verified…",
  with a retry), in doc 13 §7's toast shape — not one per tile.

### 4a. Local media errors (Week 7, doc 09 §2)

The players fetch nothing, so none of the above reaches them; their failures
come from the File System Access API, IndexedDB and the media element. The
music player's rules, as the Week 7 review corrected them:

| Where | Error | Meaning | What happens |
|---|---|---|---|
| reading the folder (`getFile`, `getFileHandle`, `entries`) | `NotAllowedError` | the grant lapsed | tile → `permission-needed`; nothing marked, nothing skipped |
| reading the folder | `NotFoundError` | the file moved or went | track marked `missing`; skip; notice |
| `trackBlobs` (path B) | row absent | the imported bytes are gone | as `NotFoundError` |
| `play()` | `NotAllowedError` | autoplay refused without a gesture | "press play"; nothing marked |
| `play()` | `AbortError` | a newer source took over | nothing — not a failure |
| media element | `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) | a format this browser cannot decode | marked `unsupported`; skip; notice |
| media element | `MEDIA_ERR_DECODE` (3) | the bytes broke, or the file changed under a snapshot | read once more; then marked `unreadable`; skip; notice |
| any of the skipping rows, three in a row | — | a library that is not there | stop; one notice. `playing` resets the count |
| scanning, the root | any | an unplugged drive, a lapsed grant | the scan stops before marking anything missing (doc 09 §2) |
| importing | `QuotaExceededError` | the disk is full | the import stops where it is and says how many were added (doc 05 §7) |
| picking a folder | `AbortError` | the reader closed the picker | nothing |
| **video** (Week 7b): picking a file | `AbortError` | the reader closed the picker | nothing; the tile stays as it was |
| video: picking a file | anything else | a picker a policy blocks | the `<input>` instead |
| video: media element | `MEDIA_ERR_SRC_NOT_SUPPORTED` (4) | a format this browser does not play | "this browser can't play this file", with the formats that play almost everywhere; the sound is never taken from music |
| video: media element | `MEDIA_ERR_NETWORK` (2), `MEDIA_ERR_DECODE` (3) | a local file changed or moved | read once more (again from its handle); then "changed or moved — open it again" |
| video: `loadedmetadata` | `videoWidth` 0 | no picture this browser can show | plays the sound, and says so |
| video: `play()` | `NotAllowedError` | autoplay refused without a gesture | "press play" |
| video: reading where it was left (IndexedDB) | any | the table will not open | the tile says so, with a retry — and still opens a video; the player starts at 0:00 |
| video: keeping its place (IndexedDB) | any | a full disk, a closed table | nothing: the place is lost, the video plays on |
| video: subtitles | no cue in the file, over 2 MB, or WebVTT the browser will not parse | not subtitles, or a video picked by mistake | "no subtitles could be read from {name}" under the video; no track; the video plays on |
| video: a recent's grant (`requestPermission`) | not `granted` | the reader refused, or the browser did | "the browser didn't allow opening this file again", beside the row or on the tile; the tile's next press picks instead |
| video: a recent's file (`getFile`) | `NotFoundError`, or any other | the file moved or was deleted | "this file isn't where it was", with its Forget |
| video: a still | the encode, or no size under 50 KB | a busy frame, or no frame to draw | no still; the tile shows the glyph |

Notices go to doc 13 §7's toast. Nothing about a file — name, path, title —
goes to the log (doc 18).

## 5. Backoff policy (client)

Per data key: on 429/`retryAfterS` respect server value; else exponential
1→2→4→8… capped 300 s with ±20 % jitter; reset on success. One global
toast per 60 s max for rate-limit events regardless of widget count
(coordinator in `swr.ts`, and since
2026-08-31 its one consumer, `stores/toast.svelte.ts` — the boolean it returns
had been discarded at the call site since Week 3, so the rule was true and
unobservable). Scheduler entries in backoff are skipped, not
removed.

**Both halves of the first sentence became true on 2026-09-01**, and neither
was before. `scheduler.execute` recomputed the next due time from the *cadence*
after a failure, and `effectiveDue` takes the later of cadence and backoff — so
the curve was dead below whatever the widget's cadence was, which at weather's
600 s is the whole of it. And "respect server value" had no reader at all:
`TpApiError.retryAfterS` was captured in `core/api.ts` and used nowhere.

The fix is in doc 04 §2. Two things about it belong here, because this is the
section that states the policy:

- **A server-named delay is not capped at 300 s.** The cap is the *curve's*.
  Upstream naming a longer wait is upstream telling us how long it will be
  unavailable, and doc 11 §6's quota trip legitimately holds to UTC midnight.
  Only our own Worker and the zone rule can name one, so there is no hostile
  value to defend against; a non-finite or negative one falls back to the curve.
- **The curve now retries sooner than the cadence, not later.** That is what an
  exponential backoff starting at 1 s means, and it is the point: a widget that
  fails once should try again in a second rather than in ten minutes. Offline,
  it means roughly twenty doomed `fetch` rejections an hour instead of six —
  accepted deliberately, because each costs no network traffic and each feeds
  `online.noteFetchResult`, which is how a captive portal is noticed at all when
  the `online` event never fires.

**"Respect server value" respected a value no server sent, until 2026-09-25.**
`core/api.ts` read the header as `Number(response.headers.get('retry-after'))`,
and `Number(null)` is `0`. The Worker's `fail(code)` sends `retry-after` only
when it has a wait to name, so every `UPSTREAM_DOWN` — and every other refusal
without one — reached the scheduler as a server-named delay of 0 s, which it
honours over the curve. A tile whose upstream was down therefore retried on
every 5 s scheduler tick for the length of the outage: twelve requests a minute
per tile, against a zone rule that blocks all of `/api/*` at sixty. The curve
the 2026-09-01 fix made reachable was unreachable again for everything except
`NETWORK` and `MALFORMED`, which never read the header. An absent, blank or
unreadable header now names nothing (`headerSeconds` in `core/api.ts`), and
`api.test.ts` has the case that was missing: a failure with no delay anywhere.
Found by the rss pacer's test for a 429 that names none.

## 6. Crash containment

Each `TpWidgetHost` wraps its widget with `<svelte:boundary>` (Svelte 5
error boundaries): a widget that throws renders a tile-local crash card
("widget gặp lỗi — thử lại / gỡ") with the error pushed to the ring
buffer; the rest of the deck keeps running. Boundary reset re-mounts the
widget fresh.
