# 05 · Storage Schema

## 1. Overview

| Store | Used for | Size class |
|-------|----------|-----------|
| localStorage | layout, settings, legal acceptance, theme | < 100 KB |
| IndexedDB (Dexie db `tilepier`) | notes, todos, events, playlists, track metadata, blobs, handles, api cache, saved places | MBs–GBs (audio blobs) |
| FSA directory handles (inside Dexie) | music library folder access (Chromium) | tiny |
| sessionStorage | crash-surviving copy of log ring buffer (doc 18) | < 64 KB |

## 2. localStorage keys (all JSON, all versioned)

### `tp.layout.v1`
```jsonc
{
  "schemaVersion": 1,
  "grid": [
    {
      "instanceId": "wgt_9f2k",   // nanoid; multiple instances of same widget allowed
      "widgetId": "weather",       // registry id
      "x": 0, "y": 0, "w": 3, "h": 2,
      "settings": { "unit": "c", "place": { "name": "Hà Nội", "lat": 21.02, "lon": 105.85 } }
    }
  ]
}
```
Per-instance widget settings live **here**, not in Dexie: they are small, they
belong to the tile, and export/import of one file restores the whole desk.

### `tp.settings.v1`
```jsonc
{
  "schemaVersion": 1,
  "locale": "vi",              // "vi" | "en"
  "theme": "dark",             // "dark" | "light" | "system"
  "accent": "#46D5C8",         // user-overridable
  "clock24h": true,
  "weekStartsOn": 1,
  "reducedMotion": "system",   // "system" | "on" | "off"
  "editLocked": false
}
```

### `tp.legal.v1`
```jsonc
{ "acceptedVersion": 1, "acceptedAt": "2026-08-30T04:00:00Z" }
```
Gate re-blocks when `LEGAL_VERSION` constant > `acceptedVersion` (doc 16 §2).

### `tp.theme.v1` — removed; folded into settings. Do not create.

## 3. Dexie schema (`core/storage/db.ts`)

```ts
db.version(1).stores({
  notes:      'id, updatedAt',                 // {id, title, body, updatedAt, pinned}
  todos:      'id, listId, done, updatedAt',   // {id, listId, text, done, due?, updatedAt}
  todoLists:  'id, order',                     // {id, name, order}
  events:     'id, dateKey',                   // {id, dateKey:"2026-08-30", title, note?, lunarPinned?}
  playlists:  'id, order',                     // {id, name, order, trackIds[]}
  tracks:     'id, addedAt, title, artist',    // metadata only (see §4)
  trackBlobs: 'id',                            // {id === track id, blob} — fallback path only
  fsaHandles: 'id',                            // {id:'musicRoot', handle: FileSystemDirectoryHandle}
  savedPlaces:'id, name',                      // map widget favorites
  focusSessions:'id, dateKey',                 // pomodoro history {id, dateKey, focusMs}
  apiCache:   'key, cachedAt',                 // {key, cachedAt, payload}
  fxHistory:  'dateKey'                        // client mirror of daily fx snapshots
});
```

Notes:
- `FileSystemDirectoryHandle` is structured-cloneable → storable in IndexedDB.
  Re-access requires `queryPermission`/`requestPermission` per session (doc 09 §2).
- `apiCache` is pruned on startup: delete entries older than 7 days, cap 500 rows.
- `trackBlobs` only exists on the fallback path (Firefox/Safari or user chose
  file-import). FSA path stores no audio bytes — files stay on disk.

## 4. Track record

```ts
interface TpTrack {
  id: string;               // hash(path|name+size) — stable across sessions
  source: 'fsa' | 'blob';
  relPath?: string;         // fsa: path relative to musicRoot
  title: string; artist: string; album: string;
  durationMs?: number; trackNo?: number; year?: number;
  coverId?: string;         // covers deduped into trackBlobs as cover:<hash>
  addedAt: number;
}
```

## 5. Migrations

- localStorage: `core/storage/local.ts` exposes `readVersioned(key, migrations[])`.
  Each migration is `(old) => new` with target version; run in order on read,
  write back once. Unknown/corrupt JSON → move raw value to
  `tp.corrupt.<key>.<ts>` and start fresh (never crash the shell on bad JSON).
- Dexie: use native `db.version(n).upgrade()` chain. Never edit a shipped
  version block; only append.
- Layout migration must tolerate unknown `widgetId` (a widget removed in a
  future release): drop the tile, log a warning to the ring buffer.

## 6. Export / Import (Settings → "Backup")

- Export: one JSON file `tilepier-backup-YYYYMMDD.json` containing
  `{ meta:{app, version, exportedAt}, layout, settings, dexie:{notes, todos,
  todoLists, events, playlists, tracks(metadata only), savedPlaces} }`.
  Audio blobs and FSA handles are **never** exported (size / permission scope);
  the import UI explains music must be re-linked.
- Import: dry-run validation (zod-lite hand validators, no runtime dep) →
  show a diff summary (counts per table) → user confirms → **non-destructive
  default**: merge-by-id with newer-`updatedAt` wins; "Replace all" requires a
  second confirmation and writes an automatic pre-import export first
  (BookmarkMagic forced-backup pattern).

## 7. Quota & eviction stance

`navigator.storage.estimate()` shown in Settings → Storage. On the blob
fallback path, warn before importing when projected usage > 80% of quota.
Request `navigator.storage.persist()` once after the user first adds music.
