# 06 · Widget Registry & Grid Contract

## 1. Manifest spec (`widgets/<id>/manifest.ts`)

```ts
export type TpRefresh =
  | { kind: 'interval'; everyMs: number; visibleOnly?: boolean }
  | { kind: 'midnight' }
  | { kind: 'manual' };

export interface TpWidgetManifest {
  id: TpWidgetId;                       // 'clock' | 'weather' | ... (union in core/types)
  i18nKey: `widget.${TpWidgetId}`;      // namespace root, not a single message
  category: TpWidgetCategory;           // 'time'|'productivity'|'finance'|'info'|'media'|'tools'
  icon: TpIconName;                     // from the internal icon set (doc 12 §6)
  sizes: {
    min: { w: number; h: number };
    max: { w: number; h: number };
    default: { w: number; h: number };
  };
  multiInstance: boolean;               // clock: true, music: false
  refresh?: TpRefresh;                  // registered with the scheduler (doc 04 §3)
  permissions?: readonly ('geolocation' | 'notifications' | 'fsa')[];
  loadWidget: () => Promise<{ default: Component }>;
  loadDetail?: () => Promise<{ default: Component }>;
}
```

Rules:

- Manifests import **nothing heavy**. Only types + the dynamic-import thunks.
  `registry.ts` statically imports every manifest → the manifest bundle is a
  few KB and ships in the entry chunk; components ship as per-widget chunks.
- `id` doubles as the chunk name (`/* @vite-chunk */` naming via
  `rolldownOptions.output.chunkFileNames` pattern) and the detail route param.
- **The drawer's one-line description (doc 13 §4) is not a manifest field.**
  `i18nKey` is the namespace root, and every manifest must have two messages
  under it — `<i18nKey>.title` and `<i18nKey>.blurb` — resolved through
  `src/lib/i18n/widget-labels.ts`, a static
  `Record<TpWidgetId, { title: () => string; blurb: () => string }>` of message
  references. This keeps manifests pure data, importable by tests and scripts
  without pulling in the Paraglide graph, and gives the drawer and the tile
  header one place to read from. `pnpm i18n:check` asserts both keys exist in
  both locales for every registered manifest.
- `TpWidgetId` and `TpWidgetCategory` are enumerated in `src/lib/core/types.ts`;
  `TpIconName` in `src/lib/ui/icons/names.ts`. A test parses the §7 table out of
  this file and asserts every manifest's `sizes` and `refresh` match it — the
  same doc-drift guard `shared-constants.test.ts` uses for doc 11 §4.

> `refresh` became a union on 2026-08-19. It was `{ everyMs: number }`, which
> could not express two rows of §7 below — `midnight tick` (calendar, quote) and
> `60 s (visible only)` (markets) — so the table and the type contradicted each
> other from the day both were written (doc 22 §Exit review). `manual` covers
> the `—` rows explicitly rather than by omission.

## 2. Widget component contract

Every `Tp<Name>Widget.svelte` receives exactly:

```ts
let { instanceId, settings, size, onOpenDetail, onUpdateSettings } = $props();
```

- `size` = current `{w,h, pxW, pxH}`; widgets adapt content density to it
  (doc 13 §3 density tiers). Widgets never read the DOM for size — the host
  passes it via ResizeObserver on the content element.
- `onUpdateSettings(partial)` persists into the tile's `settings` in
  `tp.layout.v1` (doc 05 §2).
- Detail components receive `{ instanceId, settings, onUpdateSettings, close }`.

## 3. States every widget must implement

`loading` (skeleton, doc 12 §7), `ready`, `empty` (first-run guidance with one
action), `stale`/`stale-error` (badge), `offline`, `error` (inline, never a
blank tile), `permission-needed` (geolocation/FSA prompt card). The DoD
checklist (doc 19 §6) audits all of these per widget.

## 4. Add/remove flow

- "Add widget" drawer lists manifests grouped by category with size preview.
- Adding: registry → `grid.addWidget({w,h,...defaults})` → host mounts.
- Removing: confirm only for widgets holding local data (notes/todo/music are
  shared app data, so no confirm — removing the tile never deletes data;
  say so in the tooltip).

## 5. gridstack ↔ Svelte 5 ownership contract (Spike S1 target)

The single most dangerous integration point. Fixed rules:

1. **gridstack owns** `.grid-stack` and every `.grid-stack-item` wrapper.
   These nodes are created via `grid.addWidget()` / removed via
   `grid.removeWidget()` — **never** rendered by a Svelte `{#each}`.
   Svelte must never re-order or key these nodes.
2. **Svelte owns** the content inside each item. `TpGrid.svelte` calls
   `mount(TpWidgetHost, { target: itemContentEl, props })` (Svelte 5 `mount`
   API) after `addWidget`, keeps the returned handle in a
   `Map<instanceId, MountHandle>`, and calls `unmount(handle)` in the
   `removed` event **before** the node is discarded.
3. Layout state flows one way per direction:
   - user drag/resize → gridstack `change` event → serialize → `tp.layout.v1`;
   - programmatic changes (import, reset) → `grid.batchUpdate()` +
     `load()`-equivalent rebuild → remount hosts.
   Never both at once; a `suppressChange` flag guards rebuilds.
4. Grid config: 12 columns, `cellHeight: 72`, `margin: 12`,
   `float: false`, `columnOpts` responsive breakpoints
   `{1280→12, 768→6, 480→3, else→1}` with `layout: 'compact'` on collapse.
   `draggable.handle: '.tp-drag'` (whole header in edit mode),
   `resizable.handles: 'se'`.
5. View mode: `grid.enableMove(false); grid.enableResize(false)` — the grid
   is inert; hover shows nothing. Edit mode toggles both on (doc 13 §2).
6. Destroy: on route leave / HMR dispose, `grid.destroy(false)` after
   unmounting all hosts.
7. **The setup effect must `untrack()` its body.** Mounting hosts reads the
   widget map and the callback props, and callback props get fresh function
   identities on every parent render — tracked, the effect depends on them and
   tears down and rebuilds the entire grid in a loop. Depend on the container
   element and nothing else. (Added 2026-08-10 from spike S1, where the
   untracked version locked the page solid.)
8. **Teardown must happen outside `batchUpdate()`.** gridstack 12.6 defers DOM
   work while batching, so a batched `removeAll(true, …)` leaves every
   `.grid-stack-item` in the document while removing it from the grid model —
   measured growth 7 → 15 → 25 → 37 wrappers across three rebuilds, silently.
   Unmount hosts and `removeAll()` first, then batch only the additions.
9. **`TpGrid`'s `tiles` prop is a seed, not a reactive source.** The setup
   effect is `untrack()`ed by rule 7, so it reads `tiles` exactly once at mount.
   Every subsequent change goes through the imperative surface — `addTile`,
   `removeTile`, `rebuild`. Mutating the prop and expecting the grid to follow
   does nothing, silently, which is the most plausible way for a future caller
   to get this wrong. (Added 2026-08-19 when the deck store was wired: the rule
   is a consequence of rule 7 that rule 7 does not state.)
10. **`TpGrid` must be imported dynamically from anything that renders on the
    server.** gridstack's ESM build uses extensionless relative imports
    (`./gridstack-engine`); bundlers resolve those, Node's ESM resolver does
    not, so a static import fails the prerender of `/` with
    `ERR_MODULE_NOT_FOUND`. `ssr = false` would also make the symptom go away
    and is ruled out by doc 03 — it strips the legal gate out of the HTML,
    which is the exact mistake that section was written to correct. Loading it
    on the client is the right answer regardless: gridstack is a DOM library
    with nothing to contribute to a server render, and keeping it dynamic keeps
    it out of the entry chunk. (Added 2026-08-19, when the deck page first
    imported it for real; `/spike/s1` never hit this because it sets
    `ssr = false`.)

S1 verdict (2026-08-10): **green**, with rules 7 and 8 added. The pass
criterion is now enforced by `e2e/s1-grid.e2e.ts` rather than a Memory panel:
wrapper count, mounted host count, and serialised tile count must agree after
every batch, and fifty net-neutral cycles must leave all three at baseline.

## 6. Detail expansion handshake

Grid tile → detail is a FLIP transition (doc 13 §5): host measures tile rect,
pushes `/w/[id]?i=<instanceId>` via `pushState` (shallow routing), overlay
mounts the detail chunk while animating from the tile rect. Closing reverses;
browser Back also closes (popstate handler). Direct load of `/w/[id]` renders
the detail full-screen without animation and offers "Pin to deck" if no
instance exists.

## 7. v1 registry (15 widgets)

`multi` is the `multiInstance` boolean; the parenthetical says what a second
instance is *for*, and is not part of the type. `refresh` values below are
written in the shape a test can parse against `TpRefresh`: `—` means the field
is omitted (no scheduler entry at all).

| id | category | min | default | max | multi | refresh |
|----|----------|-----|---------|-----|-------|---------|
| clock | time | 2×1 | 3×2 | 6×3 | yes | — (local 1 s) |
| timer | time | 2×2 | 3×2 | 4×3 | yes | — (local) |
| calc | tools | 2×2 | 3×3 | 4×4 | no | — |
| notes | productivity | 2×2 | 3×3 | 6×6 | yes (per-note pin) | — |
| todo | productivity | 2×2 | 3×3 | 4×6 | yes (per-list) | — |
| calendar | time | 2×2 | 3×3 | 6×5 | no | midnight |
| toolbox | tools | 2×2 | 3×2 | 4×4 | no | — |
| weather | info | 2×2 | 3×2 | 6×4 | yes (per-place) | interval 600 s |
| currency | finance | 2×1 | 3×2 | 4×4 | no | interval 12 h |
| quote | info | 2×1 | 4×2 | 6×3 | no | midnight |
| rss | info | 2×2 | 3×4 | 6×6 | yes (per-feed-set) | interval 1200 s |
| map | info | 2×2 | 4×3 | 8×6 | no | — |
| markets | finance | 2×2 | 3×3 | 6×6 | no | interval 60 s, visibleOnly |
| music | media | 2×1 | 4×2 | 6×3 | no | — |
| media | media | 2×2 | 4×3 | 8×5 | no | — |

Week 1 registers `clock` only; the array grows a row per widget as each lands
(doc 23). `core/registry.test.ts` asserts every *registered* manifest matches
its row here, so the table stays authoritative without failing on rows whose
widget has not been built yet.
