<script lang="ts">
	import type { Component } from 'svelte';
	import { logEntry } from '$lib/core/log-buffer';
	import { getManifest } from '$lib/core/registry';
	import { tileStatus } from '$lib/core/tile-status';
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
	 *
	 * The host does **not** register the manifest's `refresh` with the scheduler.
	 * It used to, with an empty `run` waiting for Week 3 to fill in — and that
	 * could never have worked: `scheduler.register` refcounts by id and the first
	 * registration's options win, so a widget registering under its own
	 * `instanceId` would silently join the no-op and never run. Widgets own their
	 * cadence through `core/refresh.svelte.ts` instead. doc 19 §6's "no scheduler
	 * leaks on remove" is unaffected: the effect simply lives one component
	 * deeper, and a widget unmounts with its host.
	 */
	interface Props {
		tile: TpTile;
		widget: Component<TpWidgetProps>;
		// `| undefined` is required, not noise: doc 20 §2 turns on
		// exactOptionalPropertyTypes, so an optional prop cannot be handed an
		// explicit undefined unless the type says so.
		onOpenDetail?: ((instanceId: string) => void) | undefined;
		onRemove?: ((instanceId: string) => void) | undefined;
		onUpdateSettings?: ((instanceId: string, partial: Record<string, unknown>) => void) | undefined;
	}

	let { tile, widget: Widget, onOpenDetail, onRemove, onUpdateSettings }: Props = $props();

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

	/**
	 * doc 13 §7’s stale badge, read straight off `core/tile-status`.
	 *
	 * No prop, and that is the whole design: this component is mounted
	 * imperatively by `TpGrid` from an event handler, so a reactive prop would
	 * have to be owned by `TpGrid` — which has no access to a widget’s `swr`
	 * handle. A module import crosses the `mount()` boundary a prop cannot.
	 */
	const status = $derived(tileStatus(tile.instanceId));
	const badgeText = $derived(
		status === undefined
			? ''
			: status.kind === 'offline'
				? m['common.tile.offline_short']()
				: status.age === ''
					? ''
					: m['common.tile.stale']({ age: status.age })
	);

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
</script>

<div
	class="tp-host"
	bind:this={contentEl}
	data-tier={tier}
	data-flat={tile.h <= 1}
	data-badged={status !== undefined}
>
	<header class="tp-drag">
		{#if manifest !== undefined}
			<TpIcon name={manifest.icon} size={14} />
		{/if}
		<span class="tp-host__title">{title}</span>
		{#if status !== undefined}
			<!--
				doc 12 §4.2: never colour alone. The badge carries its own words, so
				the lamp is reinforcement — except at h=1, where the header is a
				floating strip over the body and there is no room for the words. The
				dot is the only channel there, which is why the title carries the
				sentence and the badge carries an accessible name either way.
			-->
			<span
				class="tp-host__badge"
				data-kind={status.kind}
				data-testid="tile-badge"
				title={status.kind === 'offline'
					? m['common.tile.offline_hint']()
					: m['common.tile.stale_hint']()}
				aria-label={badgeText}
			>
				<span class="tp-host__dot" aria-hidden="true"></span>
				<span class="tp-host__badge-text" aria-hidden="true">{badgeText}</span>
			</span>
			{#if status.retry !== null}
				<button
					type="button"
					class="tp-host__retry"
					aria-label={m['common.retry']()}
					data-testid="tile-retry"
					onclick={status.retry}
				>
					<TpIcon name="refresh" size={12} />
				</button>
			{/if}
		{/if}
		<button
			type="button"
			class="tp-host__open"
			aria-label={m['common.open_detail']()}
			onclick={() => onOpenDetail?.(tile.instanceId)}
		>
			<TpIcon name="expand" size={14} />
		</button>
		<!--
			doc 13 §2: the remove control belongs to edit mode. It is always in the
			markup and revealed by the grid's `.tp-edit` class, because hosts are
			mounted imperatively and cannot take a reactive prop. `display: none`
			also keeps it out of the accessibility tree while hidden.
			No confirm: doc 06 §4 — removing a tile never deletes data.
		-->
		<button
			type="button"
			class="tp-host__remove"
			aria-label={m['common.remove_tile']()}
			data-testid="remove-{tile.instanceId}"
			onclick={() => onRemove?.(tile.instanceId)}
		>
			<TpIcon name="close" size={14} />
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
	<!--
		No host footer. doc 13 §3 draws one, and spike S1 filled it with the tile's
		own dimensions as a measurement readout — useful for proving the
		ResizeObserver worked, and product chrome for nobody. The footer that doc
		13 §3 actually describes is "meta / actions", which is per-widget content:
		notes shows updated-ago there, timer shows its streak. That belongs to the
		widget, under doc 06 §5's own division — gridstack owns the wrapper, the
		host owns the frame, and Svelte owns the content. Removed 2026-08-27, when
		the first widget with something real to put there was written.
	-->
</div>

<style>
	.tp-host {
		position: relative;
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

	.tp-host__remove {
		display: none;
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		line-height: 1;
		padding: 0.25rem;
	}

	:global(.tp-edit) .tp-host__remove {
		display: flex;
	}

	.tp-host__remove:hover {
		color: var(--color-danger);
	}

	.tp-host__badge {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		flex: none;
		border-radius: var(--radius-ctl);
		padding: 0 0.25rem;
	}

	.tp-host__dot {
		width: 6px;
		height: 6px;
		flex: none;
		border-radius: 50%;
		background: currentcolor;
	}

	.tp-host__badge[data-kind='stale'],
	.tp-host__badge[data-kind='stale-error'] {
		color: var(--color-warn);
		background: color-mix(in oklch, var(--color-warn) 12%, transparent);
	}

	.tp-host__badge[data-kind='offline'] {
		color: var(--color-fg-dim);
		background: var(--color-ink-850);
	}

	.tp-host__retry {
		display: flex;
		flex: none;
		border: 0;
		background: none;
		color: var(--color-warn);
		cursor: pointer;
		line-height: 1;
		padding: 0.25rem;
	}

	/*
	 * At h=1 the header is a strip floating over the body (below), so the words
	 * would sit on top of the tile’s own content. The lamp survives and the
	 * sentence moves into `title` and the accessible name.
	 */
	.tp-host[data-flat='true'] .tp-host__badge-text {
		display: none;
	}

	.tp-host__body {
		flex: 1 1 auto;
		min-height: 0;
		/* The body reaches the bottom edge now that the host has no footer; the
		   padding the footer used to provide moves here. */
		padding: 0 0.75rem 0.5rem;
		overflow: hidden;
	}

	/*
	 * Header leaves the FLOW entirely at h=1 (doc 13 §3), rather than the tier-S
	 * title-only hide this used to be.
	 *
	 * An h=1 tile paints 48 px once gridstack's 12 px inset is honoured, and the
	 * host's own chrome costs 38 (2 border + 28 header + 8 body padding) — which
	 * leaves 10 px for a 26.4 px hero numeral, clipped without a sound by
	 * `.tp-host__body`'s `overflow: hidden`. Out of flow, the body gets all 38.
	 *
	 * Not `display: none`: the header IS the drag handle (doc 06 §5.4,
	 * `draggable.handle: '.tp-drag'`) and carries the edit-mode remove button.
	 * And keyed on `h`, not on the tier — tier S is `w<=2 && h<=1`, so a 3×1 tile
	 * is tier M and needs this just as much.
	 *
	 * The band would otherwise swallow clicks on the top 28 px of the widget, so
	 * it is transparent to the pointer in view mode and solid again in edit mode,
	 * where being grabbable is the point.
	 */
	.tp-host[data-flat='true'] header {
		position: absolute;
		inset: 0 0 auto 0;
		justify-content: flex-end;
		pointer-events: none;
	}

	.tp-host[data-flat='true'] .tp-host__title {
		display: none;
	}

	.tp-host[data-flat='true'] .tp-host__open,
	.tp-host[data-flat='true'] .tp-host__remove,
	.tp-host[data-flat='true'] .tp-host__badge,
	.tp-host[data-flat='true'] .tp-host__retry {
		pointer-events: auto;
	}

	:global(.tp-edit) .tp-host[data-flat='true'] header {
		pointer-events: auto;
	}

	/*
	 * The body has to leave room for the controls the flat header floats above.
	 *
	 * Without it a widget that uses the full width at h=1 runs its last
	 * characters — an ellipsis, usually — underneath the expand icon. Measured
	 * on a 4×1 quote tile: the line's box ended at x=414 and the button starts
	 * at x=396. The clock did not show it because a hero numeral is short and
	 * left-aligned, which is why this survived the header rule's own review.
	 *
	 * Two widths because the cluster has two sizes: the expand button alone in
	 * view mode, and the remove button beside it in edit mode.
	 */
	.tp-host[data-flat='true'] .tp-host__body {
		padding-right: 2.25rem;
	}

	:global(.tp-edit) .tp-host[data-flat='true'] .tp-host__body {
		padding-right: 4rem;
	}

	/*
	 * A badge joins that floating cluster, so the reserve has to grow with it or
	 * the tile’s last characters run underneath it — the same bug the comment
	 * above records being measured on a 4×1 quote tile. Dot-only at h=1 keeps
	 * the extra to about ten pixels rather than fifty.
	 */
	.tp-host[data-flat='true'][data-badged='true'] .tp-host__body {
		padding-right: 3.25rem;
	}

	:global(.tp-edit) .tp-host[data-flat='true'][data-badged='true'] .tp-host__body {
		padding-right: 5rem;
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
</style>
