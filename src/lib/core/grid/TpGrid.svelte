<script lang="ts">
	import { GridStack, type GridStackNode, type GridItemHTMLElement } from 'gridstack';
	import 'gridstack/dist/gridstack.css';
	import { mount, unmount, untrack, type Component } from 'svelte';
	import type { TpWidgetProps } from '$lib/core/types';
	import TpWidgetHost from './TpWidgetHost.svelte';
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
	/** instanceId → the Svelte tree mounted inside that item's content element. */
	const hosts = new Map<string, ReturnType<typeof mount>>();
	/** instanceId → tile record, so serialise() can rejoin positions with settings. */
	const tileById = new Map<string, TpTile>();
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

	function mountHost(tile: TpTile, el: GridItemHTMLElement) {
		const target = contentElOf(el);
		if (!target) return;

		const widget = widgets[tile.widgetId];
		if (!widget) return;

		// Layout tolerates an unknown widgetId by dropping the tile (doc 05 §5);
		// here that shows up as simply not mounting anything.
		hosts.set(
			tile.instanceId,
			// Static props: hosts are mounted imperatively, so anything that
			// changes after mount — edit mode, notably — reaches them through the
			// `.tp-edit` class on this container rather than through here.
			mount(TpWidgetHost, {
				target,
				props: { tile, widget, onOpenDetail, onRemove, onUpdateSettings }
			})
		);
		onHostsChange?.(hosts.size);
	}

	function unmountHost(instanceId: string) {
		const handle = hosts.get(instanceId);
		if (!handle) return;
		unmount(handle);
		hosts.delete(instanceId);
		onHostsChange?.(hosts.size);
	}

	function emitLayout() {
		if (!grid || suppressChange) return;
		onLayoutChange?.(serialise(grid.save(false) as GridStackNode[], tileById));
	}

	// ── public imperative surface ────────────────────────────────────────────
	// Callers drive the grid through these; they never render items themselves.

	export function addTile(tile: TpTile) {
		if (!grid || hosts.has(tile.instanceId)) return;
		tileById.set(tile.instanceId, tile);
		const el = grid.addWidget(toGridStackWidget(tile));
		mountHost(tile, el);
		emitLayout();
	}

	export function removeTile(instanceId: string) {
		if (!grid) return;
		const el = containerEl?.querySelector<GridItemHTMLElement>(
			`.grid-stack-item[gs-id="${CSS.escape(instanceId)}"]`
		);
		// Unmount first — doc 06 §5.2. Once removeWidget() discards the wrapper
		// the content element is detached, and unmounting against a detached
		// tree is what leaks.
		unmountHost(instanceId);
		tileById.delete(instanceId);
		if (el) grid.removeWidget(el, true, false);
		emitLayout();
	}

	/** Programmatic rebuild — import, reset, or restoring a saved deck. */
	export function rebuild(next: TpTile[]) {
		if (!grid) return;

		suppressChange = true;
		try {
			// Teardown happens OUTSIDE batch mode. gridstack 12.6 defers DOM work
			// while batching, and `removeAll(true, …)` called inside a batch leaves
			// every `.grid-stack-item` wrapper in the document — the nodes detach
			// from the grid's model but not from the DOM. Measured: wrappers grew
			// 7 → 15 → 25 → 37 across three rebuild cycles while hosts and tiles
			// stayed correct. That is precisely the detached-node growth doc 22 §S1
			// is looking for, and it is silent: nothing throws, nothing warns.
			for (const instanceId of [...hosts.keys()]) unmountHost(instanceId);
			grid.removeAll(true, false);
			tileById.clear();

			// Only the additions are batched, which is where batching actually pays.
			grid.batchUpdate(true);
			try {
				for (const tile of next) {
					tileById.set(tile.instanceId, tile);
					mountHost(tile, grid.addWidget(toGridStackWidget(tile)));
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
		grid = GridStack.init(
			{
				column: 12,
				cellHeight: 72,
				margin: 12,
				float: false,
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

		grid.on('change', emitLayout);

		// Safety net for removals gridstack initiates itself. Our own removeTile()
		// passes triggerEvent=false, so anything arriving here is a path we did
		// not drive — unmount rather than leak.
		grid.on('removed', (_event, nodes) => {
			for (const node of nodes as GridStackNode[]) {
				if (typeof node.id === 'string') unmountHost(node.id);
			}
		});

		for (const tile of tiles) {
			tileById.set(tile.instanceId, tile);
			mountHost(tile, grid.addWidget(toGridStackWidget(tile)));
		}

		return () => {
			// doc 06 §5.6: unmount every host, then destroy the grid without
			// removing the container itself.
			for (const instanceId of [...hosts.keys()]) unmountHost(instanceId);
			tileById.clear();
			grid?.destroy(false);
			grid = undefined;
		};
	}

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
	.grid-stack {
		width: 100%;
	}

	/* Faint dot lattice while editing (doc 13 §2). */
	.tp-edit {
		background-image: radial-gradient(var(--color-ink-700) 1px, transparent 1px);
		background-size: 24px 24px;
	}

	.grid-stack :global(.grid-stack-item-content) {
		inset: 0;
		overflow: visible;
	}
</style>
