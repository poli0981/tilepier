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
blank tile), `permission-needed` (geolocation/notifications/FSA prompt card).
The DoD checklist (doc 19 §6) audits these per widget.

**Which of them apply is decided by the widget's doc 17 §3 offline class.**
Amended 2026-08-27, when the four tier-1 widgets of Week 2 were about to be
built against a list they cannot satisfy. A pure-client widget has no network,
so `stale`, `stale-error` and `offline` are not states it can reach — doc 17 §3
already says as much from the other side by classing it "fully functional"
offline. The two sections contradicted each other from the day both were
written. Requiring the states anyway buys branches that are unreachable in
production and that assert nothing when a test forces them, which is worse than
not having them: it reads as coverage.

| doc 17 §3 class | Required | N/A by class |
|---|---|---|
| Pure-client (tier 1, and `quote`) | `loading`, `ready`, `empty`, `error` | `stale`, `stale-error`, `offline` |
| Cached-data (weather, currency, markets, rss) | all seven | — |
| Search-dependent empty state (map, geocode, symbol add) | all seven | — |
| Music / media (FSA/blob, files are local) | `loading`, `ready`, `empty`, `error` | `stale`, `stale-error`, `offline` |

A state can also be unreachable for a **single widget** rather than for its
whole class — the clock has no `loading`, because the time needs no fetch, and
no `empty`, because it always has something to say. Those are as legitimate as
the class exclusions and are recorded the same way: named in the widget's own
spec section (docs 07–09) and in its PR, never left as an unexplained gap.
"Implemented every state that can happen" and "implemented four of eight" look
identical in a diff; only the note tells them apart.

**`quote` moved out of the cached-data row on 2026-08-28**, when it was built.
Doc 08 §3 has always said its dataset is bundled and that it makes no network
call — that section calls the widget "effectively Tier 1" and only sits in the
tier-2 document for historical ordering. So `stale`, `stale-error` and `offline`
were three states it could not reach, listed as required, which is the same
contradiction this table was amended to fix for tier 1 in Week 2. It reaches all
four of the pure-client states and does so genuinely: `loading` is real, because
the 23 KB catalogue arrives on a dynamic import.

`permission-needed` is orthogonal to the class and is not counted in either
column: it is required exactly when the manifest declares a `permissions`
entry, and forbidden otherwise. That is what makes `permissions` a manifest
field rather than a convention — `timer` declares `notifications`, `map`
declares `geolocation`, `music` declares `fsa`, and nothing else declares
anything.

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

11. **A mounted host's `tile` prop must be reactive; everything else must not
    be.** `mount()` reads its `props` object once, so a tile passed as a plain
    value is frozen at mount time. That is invisible until a tile's `settings`
    change after mount — and then doc 06 §2's `onUpdateSettings` contract is a
    write to storage the widget itself never sees: a detail panel sets a
    preference, `tp.layout.v1` records it, the tile behind the panel goes on
    rendering the old value, and only a reload reconciles them. `TpGrid` hands
    the tile over through a getter backed by `$state.raw` and exposes
    `updateTile(tile)`; the deck page's reconcile calls it for any tile whose
    record identity changed while its id did not. `$state.raw` and not `$state`
    because the store replaces a tile wholesale rather than mutating it, so a
    deep proxy would cost a hop on every settings read and buy nothing. The
    callbacks and the widget component stay plain values, and edit mode still
    travels by the `.tp-edit` class rather than through props, because it is a
    whole-grid concern. (Added 2026-08-27, found by an e2e test that switched
    the timer to pomodoro from its detail and watched the tile keep saying
    "countdown". Rule 9 says the `tiles` prop is a seed and every later change
    goes through the imperative surface — this is the change rule 9 did not
    have a method for.)

12. **`margin` is an INSET on `.grid-stack-item-content`, not a CSS margin — and
    a rule that sets `inset` there deletes the gutter silently.** gridstack
    writes `margin: 12` out as `--gs-item-margin-top/right/bottom/left` on
    `.grid-stack`, and `gridstack.css` spends them as `top`/`right`/`bottom`/
    `left` on the content box inside an edge-to-edge wrapper. The whole visible
    gutter is that inset. `TpGrid.svelte`'s scoped
    `.grid-stack :global(.grid-stack-item-content)` compiles to a selector of
    exactly the same specificity (Svelte bumps only the first scoped selector by
    one class and uses `:where()` thereafter), so it wins on source order — and
    `inset: 0` there had been erasing all four longhands since spike S1.

    What made it survive a green suite for four weeks is that `margin: 12`
    stayed correct in the `GridStack.init` options the whole time, and
    `cacheRects`, collision and drop-target maths read `this.opts.margin*`
    rather than the CSS. gridstack's model always assumed a 12 px gutter; only
    the paint disagreed, so every behavioural test went on passing. Two things
    followed from it that are worth knowing: the drop placeholder
    (`.placeholder-content`, a different class the override never reached) was
    24 px smaller than the tiles it predicted, and the se-resize handle — pinned
    to the same custom properties — floated 12 px inside the tile corner instead
    of on it.

    `tileRect()` must return the **content** box for the same reason. The
    wrapper is 24 px larger on each axis, and doc 13 §5's FLIP scales from those
    four numbers. (Added 2026-08-30, from a screenshot: the tiles were touching.
    `e2e/s1-grid.e2e.ts` now asserts the four insets directly, which stays valid
    at every column breakpoint.)

13. **The initial add loop must suppress change events, exactly as `rebuild()`
    does.** gridstack fires `change` **synchronously from inside `addWidget`**
    as soon as an insertion repositions tiles that are already placed
    (`makeWidget` -> `_triggerChangeEvent`). Mid-loop that reports a *prefix* of
    the deck, and the deck store persists whatever it is handed - so
    `tp.layout.v1` is truncated to however many tiles had been added when the
    first collision happened, and the reader loses the rest on the next load.

    Measured on a five-tile deck: one emit, at the third `addWidget`, three
    tiles out of five. Five wrappers rendered and three were stored, so the DOM
    and storage disagreed for exactly one load - which is why every count
    assertion in the suite stayed green. Rule 8's teardown/batch split already
    knew gridstack's event timing was the hazard here; this is the same hazard
    on the way in, and `setup()` was the one path that had not been wrapped.

    Emit **once**, after the loop, so the store still records the positions
    gridstack compacted to. (Added 2026-08-30, found when the Week 4 seed
    reached five tiles. Latent since Week 1: the bug is a property of the
    *arrangement*, not of the count, and the four-tile deck happened not to
    collide. `e2e/journey-2` now seeds an arrangement that does.)

14. **`toGridStackWidget` must emit the manifest's size bounds, and `serialise`
    must read them back.** §7's `min` and `max` columns were enforced nowhere
    until 2026-08-31: the converter returned `{id, x, y, w, h}` and nothing
    else, so gridstack had no `minW`/`minH`/`maxW`/`maxH` to spend and every
    tile drag-resized freely to 1×1 — 112×48 px once rule 12 restored the
    inset, and no widget has a rendering for it. `core/registry.test.ts`
    asserted the numbers matched the table in this file and nothing asserted
    they were applied, which is the same shape as rules 9, 11 and 13: a
    contract that reads as wired and is not.

    The bounds belong in the converter and not at the call sites because it is
    the one boundary every tile crosses on the way in — `setup()`, `addTile()`
    and `rebuild()` all go through it. gridstack then spends them twice:
    `engine.nodeBoundFix` clamps a stored size while `addWidget` runs, and
    `resizestart` turns them into the pixel limits of the drag itself. A
    widgetId with no manifest stays unbounded, because doc 05 §5 makes that
    valid data and dropping those tiles is the deck store's job.

    **A clamp on load reaches storage only through rule 13's post-loop emit.**
    `addWidget` fixes the size but `_triggerAddEvent` clears the dirty flag
    before `change` would carry it, so an added node never reports its own
    clamp. Without that emit a deck saved at 1×1 renders at the minimum while
    `tp.layout.v1` keeps the 1×1 indefinitely — rule 13's divergence, arriving
    from the other side.

    **And `serialise` must resolve an omitted `w` or `h` as the minimum, not as
    the stored size.** `grid.save()` compresses through
    `Utils.removeInternalForSave`, which drops `w` when it equals `1` *or*
    `minW` — the value is re-created from the bounds on read. Falling back to
    the stored tile is always wrong for a size, because `tileById` is written
    on add, rebuild and settings changes and never on a resize; it was merely
    unreachable while `w === 1` was the only trigger. Wiring the bounds up
    makes it reachable on every drag to the minimum, so a clock resized to 2×1
    would have gone on being stored at whatever it was before. Found by the
    e2e below rather than by review, one run after the bounds landed.

    (Added 2026-08-31. `e2e/s1-grid.e2e.ts` drags one tile past each limit and
    checks the rendered cell size, and loads `/spike/s1?oob=1` — a deck seeded
    at 1×1 — to check that the DOM and the emitted layout agree. The harness's
    tiles became `timer`, the tightest manifest registered, because an id the
    registry has never heard of gets no bounds and cannot express the
    measurement. Doc 19 §4 records the three things about driving a gridstack
    resize from Playwright that those tests had to learn the hard way,
    including one still-open question: an injected resize sometimes produces
    no `change` event at all, and whether a real pointer can do the same is
    unanswered.)

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

`min` and `max` are applied by `core/grid/layout.ts`, which turns them into
gridstack's `minW`/`minH`/`maxW`/`maxH` for every tile it hands to the grid
(§5 rule 14). They were table entries and nothing else until 2026-08-31.

The array grows a row per widget as each lands (doc 23): `clock` in Week 1;
`timer`, `calc`, `notes` and `todo` in Week 2; `calendar`, `toolbox` and `quote`
in Week 3, `weather` and `currency` in Week 4, so **ten of fifteen** are
registered as of 2026-08-31. `core/registry.test.ts` asserts every *registered*
manifest matches its row here, so the table stays authoritative without failing
on rows whose widget has not been built yet — and it checks all fifteen rows
parse, so a silent edit to an unbuilt row cannot pass either.
