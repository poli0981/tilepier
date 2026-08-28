# 04 · Data Flow

## 1. Layers

```
Widget component (runes state)
   ▲ subscribes
Widget service (per-widget: fetch, transform, validate)
   ▲ swr() helper
Client cache        localStorage: layout/settings (sync, tiny)
                    Dexie apiCache: last-good payload per data key
   ▲ on miss/stale
/api/* Worker       KV edge cache, key hiding, normalization
   ▲ on KV miss
External API
```

Rule of thumb: the **browser never talks to an external API directly**
(exception: OpenFreeMap tiles, doc 10 §6). The Worker never stores anything
user-identifying (doc 16 §3).

## 2. SWR helper (`core/swr.svelte.ts`)

Single primitive used by every networked widget. It is a `.svelte.ts` module
because what it returns is rune-backed state — "emit", below, means exactly
that, and Svelte 5 requires the infix outside components.

```ts
swr<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  opts: {
    ttlMs: number;          // client freshness window
    hardMaxAgeMs?: number;  // beyond this, don't render cached at all (default: 7d)
  }
): TpSwrHandle<T>

interface TpSwrHandle<T> {
  readonly data: T | undefined;
  readonly status: TpSwrStatus;
  readonly error: TpSwrErrorCode | undefined;
  readonly cachedAt: number | undefined;
  readonly ageMs: number | undefined;
  revalidate(reason?: string): Promise<void>;  // rejects on failure — see below
  release(): void;                             // drop this caller's subscription
}

type TpSwrStatus =
  | 'idle' | 'loading' | 'fresh' | 'stale'
  | 'stale-error' | 'offline' | 'error' | 'rate-limited';

type TpSwrErrorCode =
  | 'NETWORK' | 'RATE_LIMITED' | 'QUOTA_EXHAUSTED'
  | 'UPSTREAM_DOWN' | 'BAD_REQUEST' | 'MALFORMED';
```

Behavior:

1. Read `apiCache[key]` from Dexie. If present → emit immediately with
   `status: cachedAt < ttl ? 'fresh' : 'stale'`.
2. If stale or missing and the app is online → run `fetcher()` (which hits
   `/api/*`), emit `'fresh'`, persist to `apiCache`.
3. On fetch failure → keep last emission, flip status to `'stale-error'`
   (UI shows the stale badge, doc 13 §7). Never blank out data that exists.
4. Offline (`navigator.onLine === false` or fetch TypeError) → status
   `'offline'`; scheduler pauses this key until `online` event.
5. De-dupe: concurrent `swr()` calls with the same key share one in-flight
   promise (module-level map). `release()` drops one subscription; when the
   last subscriber releases, the map entry goes too, so the dedupe map does not
   grow with the deck.

### Status → widget state

Doc 06 §3 requires eight tile states; this section names eight statuses; doc 17
§4 names four envelope codes. Nothing connected them before, so:

| swr `status` | tile state (doc 06 §3) |
|---|---|
| `idle`, `loading` | `loading` (skeleton) |
| `fresh` | `ready` |
| `stale` | `stale` (amber dot + age) |
| `stale-error`, `rate-limited` | `stale-error` (adds retry) |
| `offline` | `offline` |
| `error` | `error` (inline, never blank) |

The remaining two tile states are the widget's own business and swr never
produces them: `empty` is a judgment about the *contents* of `data`, and
`permission-needed` is a browser-permission state swr cannot see.

Error codes map per doc 17 §4: `NETWORK` → `offline`; `RATE_LIMITED` →
`rate-limited`; `QUOTA_EXHAUSTED`, `UPSTREAM_DOWN` and `MALFORMED` →
`stale-error` when a cached payload exists, `error` when none does;
`BAD_REQUEST` → `error`, logged loudly, never retried.

> **`MALFORMED` moved on 2026-08-28**, when the taxonomy was implemented. This
> line grouped it with `BAD_REQUEST` as "never retried" while doc 17 §4 said
> "treat as `UPSTREAM_DOWN`" — the two could not both hold. Resolved in doc 17
> §4's favour: the realistic cause of a malformed body is an HTML error page
> from the edge, not a request this build got wrong, and that clears by itself.
> `BAD_REQUEST` keeps the never-retry rule because it is the one failure where
> the same request genuinely will fail the same way forever. The codes stay
> distinct so diagnostics can tell them apart; only the retry decision is
> shared (`core/api.ts`, `isRetryable`).

`revalidate()` **rejects** on failure rather than swallowing, because backoff
belongs to the scheduler (§3). swr overrides the default curve only when the
server named a delay, by calling `handle.backoff(...)` on the scheduler handle
the widget already holds.

Client TTLs are deliberately ≥ the Worker KV TTLs (doc 11 §4) so the client
never polls faster than the edge refreshes — extra polls would only get
cache hits anyway.

> **Implemented 2026-08-28**, split across two modules rather than one.
> `core/api.ts` holds the envelope and the doc 17 §4 taxonomy — no runes, no
> Dexie — and `core/swr.svelte.ts` holds caching, de-duplication and status. The
> split is what lets the first be tested in the node project against MSW and the
> second in the browser with plain stub fetchers, so neither suite has to fake
> what the other one owns. `swrCache.inspect()` is the doc 13 §10 §8 table.
>
> The doc 17 §5 rate-limit **coordinator** lives in `swr.svelte.ts` because it
> is the only module that sees every 429; the toast it will drive arrives in
> Week 4 with the first widget that can produce one, since a toast component
> with no trigger is what doc 20 §5 forbids.

> Return shape added 2026-08-19. This section previously said "emit" four times
> without saying emit *through what*, which left the entire data layer resting
> on an unspecified signature (doc 22 §Exit review, item 3). **Specified Week 1,
> implemented Week 3** with `/api/weather`'s first consumer — it cannot be
> tested honestly before there is a fetcher and MSW fixtures.

## 3. Central scheduler (`core/scheduler.ts`)

Exactly **one** `setInterval` in the whole app (tick = `SCHEDULER_TICK_MS`, 5 s).
Widgets register and receive a handle:

```ts
scheduler.register(id: string, opts: TpTaskOptions): TpTaskHandle

interface TpTaskOptions {
  cadence: TpRefresh;        // the doc 06 §1 union
  run: (ctx: { reason: TpRunReason; signal: AbortSignal }) => Promise<void> | void;
  runOnFocus?: boolean;      // default true
  runOnRegister?: boolean;   // default true
  label?: string;            // diagnostics table (doc 18 §5)
}

interface TpTaskHandle {
  readonly id: string;
  unregister(): void;                        // idempotent — the $effect teardown value
  runNow(reason?: TpRunReason): Promise<void>;
  backoff(untilMs: number): void;            // doc 17 §5
  clearBackoff(): void;
}

type TpRunReason = 'register' | 'tick' | 'visible' | 'online' | 'manual';
```

- Each tick, the scheduler runs entries whose `nextDueAt <= now`.
  Drift-free: schedule from timestamps, not from interval counts.
- `document.visibilitychange` → hidden: ticker stops entirely (battery).
  → visible: immediately run every entry that came due while hidden, unless it
  set `runOnFocus: false`, then resume ticking.
- `online` event → run all entries currently `paused`/`offline`/in backoff.
  This subscribes to `stores/online.svelte.ts`, not to the raw `online` event,
  so exactly one module decides what "online" means (doc 17 §3).
- Timers-in-widgets exception: countdown/pomodoro/clock render from
  `requestAnimationFrame`-driven or 1 s local intervals *inside* the widget,
  because sub-second display accuracy is their job. They still compute from
  wall-clock timestamps so a throttled background tab shows the correct time
  on return (doc 07 §1–2).

### The three rules this section used to leave open

**`id` is the caller's choice, not `instanceId`.** Two weather tiles pinned to
the same place share one data key but have different instance ids; registering
per instance would fetch twice for one payload. Local-only widgets pass their
`instanceId`; networked widgets pass the doc 04 §5 data key. Registrations
sharing an id are refcounted — one entry, and `unregister()` decrements.

**Overlap:** an entry already `running` is skipped on tick, never queued.
`runNow()` while running aborts the in-flight `signal` and starts fresh.

**Backoff lives here, not in swr.** A rejected `run` increments
`consecutiveFailures` and sets `nextDueAt` from the `BACKOFF` constants
(doc 17 §5); a successful run resets both. Entries in backoff are skipped, not
removed. swr only overrides the delay when the server named one.

Cadence kinds come from `TpRefresh` (doc 06 §1): `interval` schedules from
`lastRunAt + everyMs`; `visibleOnly: true` suppresses running while
`document.hidden` even when due (markets); `midnight` recomputes `nextDueAt` as
the start of the next *local* day after every run, so DST shifts absorb
themselves (calendar, quote); `manual` never self-schedules.

### Introspection

```ts
scheduler.inspect(): readonly {
  id; label; cadence;
  state: 'idle' | 'running' | 'backoff' | 'paused' | 'offline';
  lastRunAt; lastOkAt; nextDueAt; consecutiveFailures; lastError?;
}[]

scheduler.tick(now?: number): void   // test seam
```

`inspect()` is what doc 18 §5's diagnostics table renders. `tick(now)` is the
seam the fake-timer suites drive directly instead of stubbing `setInterval`.

> Handle and introspection added 2026-08-19. `register()` previously returned
> nothing and there was **no deregistration API anywhere in the suite**, while
> doc 19 §6's DoD requires "no scheduler leaks on remove" — the two could not
> both be satisfied (doc 22 §Exit review, item 3). Registration happens inside an
> `$effect` that returns `unregister` as its teardown, so removing a tile cannot
> leave a live entry behind. **Specified and implemented in Week 1**, because
> that teardown path is what the DoD rests on.

### Who registers

**The widget, not the host.** Corrected 2026-08-28. This section said "the host
now registers inside an `$effect`", and `TpWidgetHost` did — with an empty `run`,
waiting for the Week 3 data layer to fill in. That could never have worked, and
the reason is two rules of this section meeting: `register()` refcounts by id and
**the first registration's options win**, so a widget registering under its own
`instanceId` would silently join the host's no-op entry and never run. The
contract read as wired and was not, which is the same shape as the doc 06 §5
rule 11 bug found in Week 2.

The host therefore registers nothing. A widget that declares a `refresh` calls
`useRefresh(id, cadence, run)` from `core/refresh.svelte.ts`, which is the same
`$effect`-with-teardown one component deeper. The DoD is unaffected — a widget
unmounts with its host — and `id` stays the caller's choice per the rule above,
which is now a choice something can actually make: `calendar` and `quote` pass
their `instanceId`, and a networked widget will pass its data key.

## 4. Request lifecycle example — weather tile

```
mount → swr('wx:v1:w3gvk', fetchWeather, { ttlMs: 600_000 })
  ├─ Dexie hit (4 min old) → render immediately, status fresh
  └─ (nothing else; still fresh)
+10 min tick → stale → GET /api/weather?lat=21.02&lon=105.85
  Worker: key wx:v1:w3gvk   ← same string, per §5
    ├─ KV hit (age 3 min) → 200, x-tp-cache: HIT
    └─ KV miss → Open-Meteo fetch → normalize → KV put (ttl 600)
Client: render, persist apiCache, status fresh
Upstream 5xx at Worker → serve KV stale ≤ 24 h → 200, x-tp-cache: STALE
  → client renders with stale badge
Worker gets nothing (no stale, upstream down) → 503 JSON envelope
  → client keeps Dexie copy, badge 'stale-error'
```

## 5. Data keys

Convention: whitespace-free, versioned, `<domain>:<v>:<params>`. Bump the `v`
segment whenever the normalized payload shape changes — old cache entries then
simply miss instead of poisoning new parsers.

**Doc 11 §4 is authoritative for key names as well as TTLs.** The same key
string is used in the client `apiCache` and the Worker KV (prefixed `kv:`
server-side) so debugging correlates 1:1 — which only holds if there is exactly
one spelling per payload. Use the abbreviated prefixes from that table:
`wx:v1:<geohash5>`, `fx:v1:USD`, `st:se:v1:<sym>:1day`, `st:q:v1:<sym>`,
`cr:kl:v1:<sym>:<int>`, `cr:tick:v1:<set-hash>`, `geo:v1:<lang>:<q-norm>`,
`rss:v1:<url-hash>`.

Keys are never hand-written at call sites. `src/lib/shared-constants.ts`
exports one builder per key family, imported by both the widget services and
the Worker endpoints; a test asserts the builders' prefixes match doc 11 §4.

> Corrected 2026-08-10. This section previously gave
> `stock:series:v1:AAPL:1day` while doc 11 §4 names the same payload
> `st:se:v1:<sym>:1day`, and §4's own worked example used
> `weather:21.02,105.85` client-side against `wx:v1:geohash5:daily-hourly`
> server-side — so the 1:1 guarantee above was contradicted twice, once inside
> this very file. Single-spelling-via-builders is the fix.

## 6. Writes (user data)

User-data writes never touch the network. Notes/todos/events/playlists write
straight to Dexie with a 300 ms debounce for keystroke-level edits, and an
immediate flush on `visibilitychange → hidden` and `pagehide`. Layout writes
to localStorage are debounced 500 ms after gridstack `change` events settle.

## 7. Cross-tab behavior

Two TilePier tabs are legal. `storage` events sync layout/settings changes;
Dexie changes are picked up lazily (no liveQuery in v1 — last-writer-wins is
acceptable for a personal dashboard and documented in the About page).
`BroadcastChannel('tp')` reserved for v1.x if this ever needs tightening.
