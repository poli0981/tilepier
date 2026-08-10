<script lang="ts">
	import type { Component } from 'svelte';
	import type { TpTile } from './layout';

	/**
	 * The Svelte-owned half of the gridstack contract (doc 06 §5.2).
	 *
	 * gridstack owns the `.grid-stack-item` wrapper around this component;
	 * TpGrid mounts one host into each item's content element and unmounts it
	 * before the node is discarded. Nothing here may touch the wrapper.
	 *
	 * `size` is passed down rather than read from the DOM — doc 06 §2: widgets
	 * never measure themselves, the host observes and reports.
	 */
	interface Props {
		tile: TpTile;
		widget: Component<{ instanceId: string; settings: Record<string, unknown> }>;
		// `| undefined` is required, not noise: doc 20 §2 turns on
		// exactOptionalPropertyTypes, so an optional prop cannot be handed an
		// explicit undefined unless the type says so.
		onOpenDetail?: ((instanceId: string) => void) | undefined;
	}

	let { tile, widget: Widget, onOpenDetail }: Props = $props();

	let contentEl = $state<HTMLElement | null>(null);
	// Pixel box only. Grid units come from `tile` via $derived below — reading
	// them into $state here would capture the initial value and silently stop
	// tracking, which Svelte warns about as `state_referenced_locally`.
	let px = $state({ w: 0, h: 0 });
	const size = $derived({ w: tile.w, h: tile.h, pxW: px.w, pxH: px.h });

	// Reports the tile's pixel box to the widget. Batched by the browser, and
	// torn down with the host — a leaked observer here is exactly the kind of
	// thing spike S1 exists to catch.
	$effect(() => {
		const el = contentEl;
		if (!el) return;

		const observer = new ResizeObserver((entries) => {
			const box = entries[0]?.contentRect;
			if (!box) return;
			px = { w: Math.round(box.width), h: Math.round(box.height) };
		});
		observer.observe(el);

		return () => observer.disconnect();
	});

	/** Density tier from grid units (doc 13 §3). */
	const tier = $derived(tile.w <= 2 && tile.h <= 1 ? 'S' : tile.w >= 4 || tile.h >= 4 ? 'L' : 'M');
</script>

<div class="tp-host" bind:this={contentEl} data-tier={tier}>
	<header class="tp-drag">
		<span class="tp-host__title">{tile.widgetId}</span>
		<button
			type="button"
			class="tp-host__open"
			aria-label="Mở chi tiết"
			onclick={() => onOpenDetail?.(tile.instanceId)}>⤢</button
		>
	</header>
	<div class="tp-host__body">
		<Widget instanceId={tile.instanceId} settings={tile.settings} />
	</div>
	<footer class="tp-host__meta tp-num" data-testid="host-size">
		{size.w}×{size.h} · {size.pxW}×{size.pxH}
	</footer>
</div>

<style>
	.tp-host {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-900);
		box-shadow: var(--shadow-tile);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		height: 28px;
		padding: 0 0.5rem 0 0.75rem;
		flex: 0 0 auto;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	/* doc 06 §5.4: the drag handle is the tile header. */
	.tp-drag {
		cursor: grab;
	}

	.tp-host__open {
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		font-size: var(--text-2xs);
		line-height: 1;
		padding: 0.25rem;
	}

	.tp-host__open:hover {
		color: var(--color-beacon);
	}

	.tp-host__body {
		flex: 1 1 auto;
		min-height: 0;
		padding: 0 0.75rem;
		overflow: hidden;
	}

	/* Header disappears entirely at h=1 (doc 13 §3). */
	.tp-host[data-tier='S'] header .tp-host__title {
		display: none;
	}

	.tp-host__meta {
		flex: 0 0 auto;
		height: 22px;
		padding: 0 0.75rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
