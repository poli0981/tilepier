<script lang="ts">
	import { GridStack, type GridStackNode, type GridItemHTMLElement } from 'gridstack';
	import 'gridstack/dist/gridstack.css';
	import { mount, unmount, untrack, type Component } from 'svelte';
	import type { TpWidgetProps } from '#lib/core/types.js';
	import TpWidgetHost from './TpWidgetHost.svelte';
	import { arrangeState, planArrange, type TpArrangeMove, type TpArrangeState } from './arrange';
	import { serialise, toGridStackWidget, type TpLayout, type TpTile } from './layout';

	/**
	 * The gridstack ↔ Svelte 5 ownership boundary (doc 06 §5). Charter risk #1,
	 * and the target of spike S1.
	 *
	 * The rule, restated because getting it wrong is subtle: **gridstack owns
	 * `.grid-stack` and every `.grid-stack-item` wrapper; Svelte owns the
	 * content inside each item.** Items are created by `grid.addWidget()` and
	 * destroyed by `grid.removeWidget()` — never by an `{#each}`. If Svelte
	 * rendered the wrappers it would reorder and recreate nodes that gridstack
	 * holds references to, and the two would fight over the same DOM.
	 *
	 * So each item's content element gets a separately-mounted component tree
	 * via Svelte 5 `mount()`, whose handle is kept in `hosts` and released with
	 * `unmount()` **before** the wrapper is discarded. Unmounting after the node
	 * is gone leaves the effects running against a detached tree, which is the
	 * leak this spike measures.
	 */
	interface Props {
		/** Seed only — read once at mount. doc 06 §5 rule 9: every later change
		 *  goes through addTile / removeTile / rebuild, never through this prop.
		 *  readonly says so in the type rather than only in a comment. */
		tiles: readonly TpTile[];
		/** Registry stand-in: instanceId's widget component, by widgetId. */
		widgets: Record<string, Component<TpWidgetProps>>;
		editMode?: boolean;
		onLayoutChange?: (layout: TpLayout) => void;
		onOpenDetail?: (instanceId: string) => void;
		onRemove?: (instanceId: string) => void;
		/** The edit-mode Arrange button: the keyboard and single-pointer way to
		 *  move and resize a tile (doc 06 §5, WCAG 2.1.1 and 2.5.7). */
		onArrange?: (instanceId: string) => void;
		onUpdateSettings?: (instanceId: string, partial: Record<string, unknown>) => void;
		/** Fires whenever a host is mounted or unmounted — see the note on `hosts`. */
		onHostsChange?: (count: number) => void;
	}

	let {
		tiles,
		widgets,
		editMode = false,
		onLayoutChange,
		onOpenDetail,
		onRemove,
		onArrange,
		onUpdateSettings,
		onHostsChange
	}: Props = $props();

	let containerEl = $state<HTMLDivElement | null>(null);
	let grid: GridStack | undefined;

	/*
	 * These two are intentionally plain Maps, not SvelteMap.
	 *
	 * `svelte/prefer-svelte-reactivity` exists to catch "I mutated a Map and
	 * expected the UI to update". The opposite is wanted here: this is internal
	 * bookkeeping for imperative mounting, read only from event handlers and
	 * teardown. Making it reactive would let a mutation inside `$effect` — which
	 * is exactly where mounting happens — register as a dependency of that same
	 * effect and re-run it. Host count is published deliberately through
	 * `onHostsChange` instead.
	 */
	/* eslint-disable svelte/prefer-svelte-reactivity */
	/** instanceId → the mounted tree, plus the one lever that can change its
	 *  props after the fact. See `mountHost` for why that lever exists. */
	const hosts = new Map<
		string,
		{
			handle: ReturnType<typeof mount>;
			setTile: (t: TpTile) => void;
			setOrdinal: (n: number) => void;
		}
	>();
	/** instanceId → tile record, so serialise() can rejoin positions with settings. */
	const tileById = new Map<string, TpTile>();
	/**
	 * instanceId → a wrapper that is on the grid with nothing mounted in it yet,
	 * because its widget's component had not arrived when it was added. The
	 * effect after `setup` mounts it the moment `widgets` carries it.
	 *
	 * Before 2026-09-29 `mountHost` simply returned in that case, and nothing
	 * came back for the wrapper. The deck page renders its empty message rather
	 * than this component when there are no tiles, so the first tile added to a
	 * deck *loaded* empty mounts a fresh grid whose seed is that tile — while the
	 * tile's chunk is still downloading. The page then adopts the seed as
	 * mounted, and the reader got an empty tile until they reloaded.
	 * `e2e/journey-2` "a deck loaded empty" is the case.
	 */
	const pending = new Map<string, GridItemHTMLElement>();
	/* eslint-enable svelte/prefer-svelte-reactivity */

	/**
	 * Guards the one-way rule in doc 06 §5.3: user gestures flow grid → layout,
	 * programmatic rebuilds flow layout → grid, and never both at once. Without
	 * this, a rebuild's own change events feed straight back into the store.
	 */
	let suppressChange = false;

	function contentElOf(el: GridItemHTMLElement): HTMLElement | null {
		return el.querySelector<HTMLElement>('.grid-stack-item-content');
	}

	/** The wrapper gridstack made for a tile. The `gs-id` selector is gridstack's
	 *  DOM contract, and this file is the only one allowed to know it. */
	function wrapperOf(instanceId: string): GridItemHTMLElement | null {
		return (
			containerEl?.querySelector<GridItemHTMLElement>(
				`.grid-stack-item[gs-id="${CSS.escape(instanceId)}"]`
			) ?? null
		);
	}

	/**
	 * Numbers the tiles that share a widget, in the order they joined the deck,
	 * so "Open Clock detail" names one tile rather than two (doc 13 §8). A widget
	 * on the deck once gets 0, which the host reads as "no number".
	 */
	function renumber(): void {
		// Plain records: counts for one pass, read by nothing that renders.
		const counts: Record<string, number> = {};
		for (const tile of tileById.values()) counts[tile.widgetId] = (counts[tile.widgetId] ?? 0) + 1;
		const seen: Record<string, number> = {};
		for (const [instanceId, tile] of tileById) {
			const nth = (seen[tile.widgetId] ?? 0) + 1;
			seen[tile.widgetId] = nth;
			hosts.get(instanceId)?.setOrdinal((counts[tile.widgetId] ?? 0) > 1 ? nth : 0);
		}
	}

	/**
	 * A wrapper for `tile`, from gridstack. Since gridstack 14 `addWidget` is
	 * typed as maybe-undefined: it answers nothing for an empty or string
	 * definition, or when its own element hook makes no element — none of which
	 * a tile from `toGridStackWidget` can be. So nothing here is a bug, and it
	 * throws rather than leave a tile in the deck with no host.
	 */
	function place(tile: TpTile): GridItemHTMLElement {
		const el = grid?.addWidget(toGridStackWidget(tile));
		if (el === undefined)
			throw new Error(`TpGrid: gridstack made no wrapper for ${tile.instanceId}`);
		return el;
	}

	function mountHost(tile: TpTile, el: GridItemHTMLElement, override?: Component<TpWidgetProps>) {
		const target = contentElOf(el);
		if (!target) return;

		const widget = override ?? widgets[tile.widgetId];
		if (!widget) {
			// Not yet, rather than never — see `pending`.
			pending.set(tile.instanceId, el);
			return;
		}
		pending.delete(tile.instanceId);

		/*
		 * `tile` is handed over through a getter backed by `$state.raw`, and it
		 * has to be.
		 *
		 * `mount()` reads its `props` object once. Passing the tile as a plain
		 * value freezes it at mount time, which is invisible until something
		 * changes a tile's `settings` after mount — and then doc 06 §2's whole
		 * `onUpdateSettings` contract is a write to storage that the widget
		 * itself never sees. A detail panel could set a preference, the layout
		 * key would record it, the tile behind the panel would go on rendering
		 * the old value, and only a reload would reconcile them. Found
		 * 2026-08-27 by an e2e test that switched the timer to pomodoro from its
		 * detail and watched the tile keep saying "countdown".
		 *
		 * `$state.raw` rather than `$state`: the tile is replaced wholesale by
		 * the store on every edit, never mutated in place, so deep-proxying its
		 * contents would buy nothing and cost a proxy on every settings read.
		 *
		 * Everything else stays a plain value. Edit mode still travels by the
		 * `.tp-edit` class on the container rather than through props, because
		 * it is a whole-grid concern and not a per-tile one.
		 */
		let current = $state.raw(tile);
		// Set by `renumber`, which only this component can run: it needs every
		// tile, and a host sees its own.
		let ordinal = $state(0);

		const handle = mount(TpWidgetHost, {
			target,
			props: {
				get tile() {
					return current;
				},
				get ordinal() {
					return ordinal;
				},
				widget,
				onOpenDetail,
				onRemove,
				onArrange,
				onUpdateSettings
			}
		});

		// Layout tolerates an unknown widgetId by dropping the tile (doc 05 §5);
		// here that shows up as simply not mounting anything.
		hosts.set(tile.instanceId, {
			handle,
			setTile: (next: TpTile) => {
				current = next;
			},
			setOrdinal: (n: number) => {
				ordinal = n;
			}
		});
		renumber();
		onHostsChange?.(hosts.size);
	}

	function unmountHost(instanceId: string) {
		pending.delete(instanceId);
		const entry = hosts.get(instanceId);
		if (!entry) return;
		unmount(entry.handle);
		hosts.delete(instanceId);
		onHostsChange?.(hosts.size);
	}

	function emitLayout() {
		if (!grid || suppressChange) return;
		onLayoutChange?.(serialise(grid.save(false) as GridStackNode[], tileById));
	}

	// ── public imperative surface ────────────────────────────────────────────
	// Callers drive the grid through these; they never render items themselves.

	/**
	 * `widget` is the component to mount, and it is a parameter rather than a
	 * lookup for a reason found on 2026-08-28: the `widgets` prop is loaded once
	 * from the *seeded* deck's ids, so adding a widget whose chunk had never
	 * been loaded found nothing in it and `mountHost` returned silently —
	 * leaving a real `.grid-stack-item` wrapper with nothing inside. The tile
	 * looked added, the layout recorded it, and it only appeared after a reload.
	 *
	 * Latent since Week 1 and invisible because `e2e/journey-2` adds `clock`,
	 * which is already on the seeded deck and therefore already loaded; and
	 * because that journey asserts wrapper *counts*, which were correct.
	 *
	 * Passing it in removes the timing question entirely — the caller awaits the
	 * import and hands over the result, so there is no window in which the prop
	 * has not propagated yet.
	 */
	export function addTile(tile: TpTile, widget?: Component<TpWidgetProps>) {
		if (!grid || hosts.has(tile.instanceId)) return;
		tileById.set(tile.instanceId, tile);

		// Already on the grid and waiting for this very component: fill the
		// wrapper it has. A second `addWidget` would put the same instance on the
		// grid twice — gridstack tells nodes apart by its own `_id`, not by `id`.
		const waiting = pending.get(tile.instanceId);
		if (waiting !== undefined) {
			mountHost(tile, waiting, widget);
			return;
		}

		const el = place(tile);
		mountHost(tile, el, widget);
		emitLayout();
	}

	export function removeTile(instanceId: string) {
		if (!grid) return;
		const el = wrapperOf(instanceId);
		// Unmount first — doc 06 §5.2. Once removeWidget() discards the wrapper
		// the content element is detached, and unmounting against a detached
		// tree is what leaks.
		unmountHost(instanceId);
		tileById.delete(instanceId);
		renumber();
		if (el) grid.removeWidget(el, true, false);
		emitLayout();
	}

	/** Programmatic rebuild — import, reset, or restoring a saved deck. */
	export function rebuild(next: TpTile[]) {
		if (!grid) return;

		suppressChange = true;
		try {
			// Teardown happens OUTSIDE batch mode. gridstack defers DOM work while
			// batching (12.6 did, and 14 still does), and `removeAll(true, …)`
			// called inside a batch leaves every `.grid-stack-item` wrapper in the
			// document — the nodes detach from the grid's model but not from the
			// DOM. Measured: wrappers grew
			// 7 → 15 → 25 → 37 across three rebuild cycles while hosts and tiles
			// stayed correct. That is precisely the detached-node growth doc 22 §S1
			// is looking for, and it is silent: nothing throws, nothing warns.
			for (const instanceId of [...hosts.keys()]) unmountHost(instanceId);
			pending.clear();
			grid.removeAll(true, false);
			tileById.clear();

			// Only the additions are batched, which is where batching actually pays.
			grid.batchUpdate(true);
			try {
				for (const tile of next) {
					tileById.set(tile.instanceId, tile);
					mountHost(tile, place(tile));
				}
			} finally {
				grid.batchUpdate(false);
			}
		} finally {
			suppressChange = false;
		}
		emitLayout();
	}

	export function snapshot(): TpLayout {
		if (!grid) return { schemaVersion: 1, grid: [] };
		return serialise(grid.save(false) as GridStackNode[], tileById);
	}

	export function mountedHostCount(): number {
		return hosts.size;
	}

	/**
	 * Where a tile is on screen right now — the FLIP origin, and on close the
	 * FLIP target, which doc 13 §5.3 requires be recomputed because the grid may
	 * have reflowed while the panel was open.
	 *
	 * It lives here rather than in the caller because the `gs-id` selector is
	 * gridstack's DOM contract, and this file is the only one that is allowed to
	 * know it — `removeTile` above uses the same query for the same reason.
	 */
	/**
	 * Pushes a changed tile record into an already-mounted host — the other half
	 * of the getter above. Position changes do not come through here (gridstack
	 * owns those and reports them back out); this is for `settings`, which flow
	 * the other way, from the store into the widget.
	 */
	export function updateTile(next: TpTile) {
		tileById.set(next.instanceId, next);
		hosts.get(next.instanceId)?.setTile(next);
	}

	export function tileRect(instanceId: string): DOMRect | null {
		const el = wrapperOf(instanceId);
		// The content box, not the wrapper. gridstack sizes the wrapper edge to
		// edge and insets the content by `margin` (12), so the wrapper is 24 px
		// wider and taller than the tile a user can see. The FLIP scales from
		// these four numbers, so handing it the wrapper starts the panel oversized
		// and lands it off-origin. The two were the same box only while the
		// `inset: 0` in this file's style block was deleting the gutter.
		return (el && contentElOf(el))?.getBoundingClientRect() ?? null;
	}

	/**
	 * One step of the Arrange dialog (doc 06 §5, doc 13 §8): moves or resizes a
	 * tile through `grid.update`, which fires gridstack's own `change` and so
	 * reaches the store exactly as a drag does. `arrange.ts` works out where the
	 * step goes and whether it changes anything; nothing here guesses.
	 *
	 * Returns the tile's place afterwards, or null when there is no such tile.
	 */
	export function arrange(instanceId: string, move: TpArrangeMove): TpArrangeState | null {
		const el = wrapperOf(instanceId);
		const node = el?.gridstackNode;
		if (!grid || !el || !node) return null;

		const position = planArrange(grid.engine, node, move);
		if (position !== null) grid.update(el, position);
		// The dialog docks at the foot of the screen, and the tile has to stay in
		// sight while it moves.
		contentElOf(el)?.scrollIntoView({ block: 'nearest' });
		return arrangeState(grid.engine, node);
	}

	/** Where a tile is now and which steps are open to it, without moving it. */
	export function arrangement(instanceId: string): TpArrangeState | null {
		const node = wrapperOf(instanceId)?.gridstackNode;
		return grid && node ? arrangeState(grid.engine, node) : null;
	}

	/**
	 * Marks the tile the Arrange dialog is moving, or clears the mark. On the
	 * content element, never the wrapper: the wrapper is gridstack's (doc 06 §5).
	 */
	export function markArranging(instanceId: string | null): void {
		for (const marked of containerEl?.querySelectorAll('[data-arranging]') ?? [])
			marked.removeAttribute('data-arranging');
		if (instanceId === null) return;
		const el = wrapperOf(instanceId);
		const content = el && contentElOf(el);
		content?.setAttribute('data-arranging', '');
		content?.scrollIntoView({ block: 'nearest' });
	}

	/**
	 * The tile a removal should leave focus on: the next one in reading order,
	 * or the one before when it was the last. gridstack keeps the wrappers in
	 * that order (`_sortDom`), which is also the Tab order. Asked *before* the
	 * removal, since the reconcile effect removes it later (doc 13 §8).
	 */
	export function neighbourOf(instanceId: string): string | null {
		const ids = [...(containerEl?.querySelectorAll<GridItemHTMLElement>('.grid-stack-item') ?? [])]
			.map((el) => el.getAttribute('gs-id'))
			.filter((id): id is string => id !== null);
		const index = ids.indexOf(instanceId);
		if (index === -1) return null;
		return ids[index + 1] ?? ids[index - 1] ?? null;
	}

	/** The tile's name as its own controls say it: TpWidgetHost's title,
	 *  numbered when the widget is on the deck more than once. */
	export function tileName(instanceId: string): string | null {
		const el = wrapperOf(instanceId);
		const region = el && contentElOf(el)?.querySelector<HTMLElement>('[aria-labelledby]');
		const id = region?.getAttribute('aria-labelledby');
		return (id ? document.getElementById(id)?.textContent?.trim() : undefined) ?? null;
	}

	/** Puts focus on a tile's first control meant to receive it (TpWidgetHost
	 *  marks it). Answers whether there was one to focus. */
	export function focusTile(instanceId: string): boolean {
		const el = wrapperOf(instanceId);
		const target = el && contentElOf(el)?.querySelector<HTMLElement>('[data-tile-focus]');
		if (!target) return false;
		target.focus();
		return document.activeElement === target;
	}

	// ── lifecycle ────────────────────────────────────────────────────────────

	$effect(() => {
		// Synchronises the gridstack instance with the container element: creates
		// it on mount, tears it down on destroy.
		//
		// The body is untracked deliberately. Mounting hosts reads `widgets`,
		// `onOpenDetail` and `onHostsChange`, and callback props are fresh
		// function identities on every parent render. Tracked, that makes this
		// effect depend on them: mount a host → notify the parent → parent
		// re-renders → new callback identity → effect re-runs → destroy and
		// rebuild the entire grid → mount a host → … The page locks up hard
		// enough that Playwright cannot even read `body`. This effect must
		// depend on the container element and nothing else.
		const el = containerEl;
		if (!el) return;

		return untrack(() => setup(el));
	});

	function setup(el: HTMLDivElement) {
		const created = GridStack.init(
			{
				column: 12,
				cellHeight: 72,
				margin: 12,
				// No `mode`: its default, 'top', floats tiles up as `float: false`
				// did until gridstack 14 replaced that option.
				// doc 06 §5.4. Breakpoints are grid-width based; below 480 the deck
				// collapses to a single column.
				columnOpts: {
					layout: 'compact',
					breakpoints: [
						{ w: 480, c: 1 },
						{ w: 768, c: 3 },
						{ w: 1280, c: 6 }
					]
				},
				draggable: { handle: '.tp-drag' },
				resizable: { handles: 'se' },
				animate: false
			},
			el
		);
		// Null only without a document or without the element (gridstack 14 says
		// so in its types). This is the container this component rendered, on
		// the client, so a null is a bug, and says so.
		if (created === null) throw new Error('TpGrid: gridstack could not take its container');
		grid = created;

		grid.on('change', emitLayout);

		// Safety net for removals gridstack initiates itself. Our own removeTile()
		// passes triggerEvent=false, so anything arriving here is a path we did
		// not drive — unmount rather than leak.
		grid.on('removed', (_event, nodes) => {
			for (const node of nodes as GridStackNode[]) {
				if (typeof node.id === 'string') unmountHost(node.id);
			}
		});

		// Suppressed for exactly the reason `rebuild()` suppresses, and it was
		// missing here: gridstack fires `change` **synchronously from inside
		// `addWidget`** as soon as an insertion makes it reposition the tiles
		// already placed (`makeWidget` → `_triggerChangeEvent`). Mid-loop that
		// reports a *prefix* of the deck, and the deck store persists whatever it
		// is handed — so the layout is truncated to however many tiles had been
		// added when the first collision happened, permanently. Measured on the
		// five-tile Week 4 seed: one emit, at the third `addWidget`, three tiles
		// out of five, and the two missing ones gone from `tp.layout.v1` for good.
		//
		// It never fired through Week 3 because the four-tile seed happened not to
		// collide during the loop — the bug is a property of the arrangement, not
		// of the count. doc 06 §5 rule 13.
		suppressChange = true;
		try {
			for (const tile of tiles) {
				tileById.set(tile.instanceId, tile);
				mountHost(tile, place(tile));
			}
		} finally {
			suppressChange = false;
		}
		// Once, with the whole deck — gridstack may have compacted it, and that
		// is what the store should record. Rule 14's clamp reaches storage the
		// same way and only this way: `addWidget` fixes an out-of-bounds stored
		// size inside `nodeBoundFix`, but `_triggerAddEvent` clears the dirty
		// flag that a `change` would have carried, so an added node never
		// reports its own clamp. Without this emit a deck saved at 1×1 would
		// render at the manifest minimum while `tp.layout.v1` kept the 1×1
		// indefinitely — the divergence rule 13 was written about, arriving from
		// the other side.
		emitLayout();

		return () => {
			// doc 06 §5.6: unmount every host, then destroy the grid without
			// removing the container itself.
			for (const instanceId of [...hosts.keys()]) unmountHost(instanceId);
			pending.clear();
			tileById.clear();
			grid?.destroy(false);
			grid = undefined;
		};
	}

	$effect(() => {
		// Mounts the wrappers that were added before their widget's chunk had
		// arrived (see `pending`), whenever `widgets` gains one. Tracks `widgets`
		// and nothing else: the body is untracked for the same reason `setup`'s
		// is — mounting notifies the parent, and a tracked callback prop would
		// turn that notification into a re-run of this effect.
		const available = widgets;
		untrack(() => {
			for (const [instanceId, el] of [...pending]) {
				const tile = tileById.get(instanceId);
				if (tile !== undefined && available[tile.widgetId] !== undefined) mountHost(tile, el);
			}
		});
	});

	$effect(() => {
		// Synchronises interaction affordances with edit mode (doc 06 §5.5): the
		// grid is inert in view mode.
		grid?.enableMove(editMode);
		grid?.enableResize(editMode);
	});
</script>

<div
	class="grid-stack"
	class:tp-edit={editMode}
	bind:this={containerEl}
	data-testid="tp-grid"
></div>

<style>
	/*
	 * A stacking context of its own. gridstack 14 gives the resize handles
	 * z-index 100 and 101, and the dragged tile 10000; in the page's context
	 * a hovered tile's handle painted over the top bar (50), the drawer (60) and
	 * the detail (90). Inside the grid they still rise above the tiles, which
	 * is what gridstack wants them for, and no further.
	 */
	.grid-stack {
		width: 100%;
		isolation: isolate;
	}

	/* Faint dot lattice while editing (doc 13 §2). */
	.tp-edit {
		background-image: radial-gradient(var(--color-ink-700) 1px, transparent 1px);
		background-size: 24px 24px;
	}

	/*
	 * Never set `inset` / `top` / `right` / `bottom` / `left` here.
	 *
	 * gridstack paints its `margin` as the INSET of this element inside an
	 * edge-to-edge wrapper (gridstack.css, `.grid-stack > .grid-stack-item >
	 * .grid-stack-item-content { top: var(--gs-item-margin-top); … }`), which it
	 * writes from the init options. A rule here ties that one at (0,3,0) and wins
	 * on source order, so `inset: 0` deleted the whole gutter — silently, because
	 * `margin: 12` stayed in the JS opts and every piece of gridstack's own
	 * collision and drop math went on assuming it. Only the paint disagreed.
	 * Doc 06 §5 rule 12.
	 *
	 * `overflow` is a separate override, of a separate gridstack rule
	 * (`overflow-x: hidden; overflow-y: auto`), and stays: it is what lets
	 * `--shadow-tile` paint outside the content box.
	 */
	.grid-stack :global(.grid-stack-item-content) {
		overflow: visible;
	}

	/* The tile the Arrange dialog is moving (`markArranging`). An outline, so it
	   takes no room and survives forced colours (doc 12 §10). */
	.grid-stack :global(.grid-stack-item-content[data-arranging]) {
		border-radius: var(--radius-tile);
		outline: 2px solid var(--color-beacon);
		outline-offset: 3px;
	}
</style>
