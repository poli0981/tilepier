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

## 2. SWR helper (`core/swr.ts`)

Single primitive used by every networked widget:

```ts
swr<T>(key: string, fetcher: () => Promise<T>, opts: {
  ttlMs: number;          // client freshness window
  hardMaxAgeMs?: number;  // beyond this, don't render cached at all (default: 7d)
})
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
   promise (module-level map).

Client TTLs are deliberately ≥ the Worker KV TTLs (doc 11 §4) so the client
never polls faster than the edge refreshes — extra polls would only get
cache hits anyway.

## 3. Central scheduler (`core/scheduler.ts`)

Exactly **one** `setInterval` in the whole app (tick = 5 s). Widgets register:

```ts
scheduler.register(instanceId, { everyMs, run, runOnFocus = true })
```

- Each tick, the scheduler runs entries whose `lastRun + everyMs <= now`.
  Drift-free: schedule from timestamps, not from interval counts.
- `document.visibilitychange` → hidden: ticker stops entirely (battery).
  → visible: immediately run every entry whose data went stale while hidden,
  then resume ticking.
- `online` event → run all entries currently in `'offline'`/`'stale-error'`.
- Timers-in-widgets exception: countdown/pomodoro/clock render from
  `requestAnimationFrame`-driven or 1 s local intervals *inside* the widget,
  because sub-second display accuracy is their job. They still compute from
  wall-clock timestamps so a throttled background tab shows the correct time
  on return (doc 07 §1–2).

## 4. Request lifecycle example — weather tile

```
mount → swr('weather:21.02,105.85', fetchWeather, { ttlMs: 600_000 })
  ├─ Dexie hit (4 min old) → render immediately, status fresh
  └─ (nothing else; still fresh)
+10 min tick → stale → GET /api/weather?lat=21.02&lon=105.85
  Worker: key wx:v1:geohash5:daily-hourly
    ├─ KV hit (age 3 min) → 200, x-tp-cache: HIT
    └─ KV miss → Open-Meteo fetch → normalize → KV put (ttl 600)
Client: render, persist apiCache, status fresh
Upstream 5xx at Worker → serve KV stale ≤ 24 h → 200, x-tp-cache: STALE
  → client renders with stale badge
Worker gets nothing (no stale, upstream down) → 503 JSON envelope
  → client keeps Dexie copy, badge 'stale-error'
```

## 5. Data keys

Convention `": "`-free, versioned: `<domain>:<v>:<params>` e.g.
`wx:v1:w3gvk`, `fx:v1:USD`, `stock:series:v1:AAPL:1day`. Bump the `v`
segment whenever the normalized payload shape changes — old cache entries
then simply miss instead of poisoning new parsers. Same key string is used
in the client `apiCache` and the Worker KV (prefixed `kv:` server-side)
so debugging correlates 1:1.

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
