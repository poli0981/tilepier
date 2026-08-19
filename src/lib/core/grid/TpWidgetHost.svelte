<script lang="ts">
	import type { Component } from 'svelte';
	import { logEntry } from '$lib/core/log-buffer';
	import { getManifest } from '$lib/core/registry';
	import { scheduler } from '$lib/core/scheduler';
	import type { TpTileSize, TpWidgetProps } from '$lib/core/types';
	import { widgetLabels } from '$lib/i18n/widget-labels';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
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
		widget: Component<TpWidgetProps>;
		// `| undefined` is required, not noise: doc 20 §2 turns on
		// exactOptionalPropertyTypes, so an optional prop cannot be handed an
		// explicit undefined unless the type says so.
		onOpenDetail?: ((instanceId: string) => void) | undefined;
		onUpdateSettings?: ((instanceId: string, partial: Record<string, unknown>) => void) | undefined;
	}

	let { tile, widget: Widget, onOpenDetail, onUpdateSettings }: Props = $props();

	const manifest = $derived(getManifest(tile.widgetId));
	const labels = $derived(manifest === undefined ? undefined : widgetLabels(manifest.id));
	const title = $derived(labels?.title() ?? tile.widgetId);

	let contentEl = $state<HTMLElement | null>(null);
	// Pixel box only. Grid units come from `tile` via $derived below — reading
	// them into $state here would capture the initial value and silently stop
	// tracking, which Svelte warns about as `state_referenced_locally`.
	let px = $state({ w: 0, h: 0 });

	/** Density tier from grid units (doc 13 §3). */
	const tier = $derived(tile.w <= 2 && tile.h <= 1 ? 'S' : tile.w >= 4 || tile.h >= 4 ? 'L' : 'M');
	const size = $derived<TpTileSize>({ w: tile.w, h: tile.h, pxW: px.w, pxH: px.h, tier });

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

	// Registers whatever the manifest declares, and returns `unregister` as the
	// teardown. This is what makes doc 19 §6's "no scheduler leaks on remove"
	// structural: removing a tile unmounts the host, which runs this cleanup,
	// so there is no separate discipline to remember. `e2e/s1-grid` asserts
	// scheduler.size returns to baseline across fifty add/remove cycles.
	$effect(() => {
		const refresh = manifest?.refresh;
		if (refresh === undefined || refresh.kind === 'manual') return;

		const handle = scheduler.register(tile.instanceId, {
			cadence: refresh,
			label: `${tile.widgetId}:${tile.instanceId}`,
			run: () => {
				// Widgets own their own fetching through swr() (Week 3); the host
				// only owns the schedule and its teardown.
			}
		});
		return () => handle.unregister();
	});
</script>

<div class="tp-host" bind:this={contentEl} data-tier={tier}>
	<header class="tp-drag">
		{#if manifest !== undefined}
			<TpIcon name={manifest.icon} size={14} />
		{/if}
		<span class="tp-host__title">{title}</span>
		<button
			type="button"
			class="tp-host__open"
			aria-label={m['common.open_detail']()}
			onclick={() => onOpenDetail?.(tile.instanceId)}
		>
			<TpIcon name="expand" size={14} />
		</button>
	</header>
	<div class="tp-host__body">
		<!--
			doc 17 §6: a widget that throws renders a tile-local crash card and the
			rest of the deck keeps running. The push to the ring buffer is explicit
			— a boundary catches the error itself, so it never reaches SvelteKit's
			handleError and would otherwise vanish.
		-->
		<svelte:boundary
			onerror={(error) =>
				logEntry('error', `widget "${tile.widgetId}" crashed`, { src: 'boundary', error })}
		>
			<Widget
				instanceId={tile.instanceId}
				settings={tile.settings}
				{size}
				onOpenDetail={onOpenDetail === undefined ? undefined : () => onOpenDetail(tile.instanceId)}
				onUpdateSettings={onUpdateSettings === undefined
					? undefined
					: (partial: Record<string, unknown>) => onUpdateSettings(tile.instanceId, partial)}
			/>

			{#snippet failed(_error, reset)}
				<div class="tp-host__crash" role="alert">
					<p>{m['common.widget_crashed']()}</p>
					<button type="button" onclick={reset}>{m['common.retry']()}</button>
				</div>
			{/snippet}
		</svelte:boundary>
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
		gap: 0.375rem;
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

	.tp-host__title {
		flex: 1 1 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-host__open {
		display: flex;
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
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

	.tp-host__crash {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-host__crash p {
		margin: 0;
	}

	.tp-host__crash button {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		padding: 0.25rem 0.6rem;
	}

	.tp-host__meta {
		flex: 0 0 auto;
		height: 22px;
		padding: 0 0.75rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
