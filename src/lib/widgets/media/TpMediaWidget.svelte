<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';
	import { pickVideo } from './picker';
	import { reopen } from './recents';
	import { media } from './store.svelte';

	/**
	 * doc 09 §3's tile: the video open in this page — its name, how far in,
	 * and the way back to it — or the one way to open one.
	 *
	 * **Opening from the tile is one click.** The picker runs in the click (it
	 * needs the activation), the chosen file goes to the shared store, and the
	 * detail that opens plays it. The tile never holds a `<video>`: the detail
	 * does, so picture-in-picture ends with it (owner decision Q2).
	 *
	 * **After a reload** it shows the last video worth coming back to, with
	 * its still, read from storage (`recents.ts`). One opened through the
	 * picker opens again from its handle — the browser asks first, in the click.
	 * Any other, or one the browser refused or could not find, is picked again,
	 * and the same file picked again finds its place.
	 *
	 * **States (doc 06 §3, the music/media class):** `loading` and `error`
	 * are that read — an error still offers a video, since a table that will not
	 * open is no reason not to play one — then `ready` (a video open, or one to
	 * come back to) and `empty`. `stale`, `stale-error` and `offline` do
	 * not apply, nothing is fetched; and `permission-needed` does not either —
	 * the manifest declares no permissions.
	 */
	let { size, onOpenDetail }: TpWidgetProps = $props();

	$effect(() => {
		// Where the reader left off, read once per page, shared with the detail.
		untrack(() => void media.loadShelf());
	});

	const roomy = $derived(size.h >= 3);

	/** The video open in this page, else the last one worth coming back to. */
	const shown = $derived.by(() => {
		const open = media.current;
		if (open !== null) {
			const { positionMs, durationMs, poster } = media;
			return { name: open.name, positionMs, durationMs, poster, inHand: true };
		}
		const last = media.last;
		return last === null ? null : { ...last, inHand: false };
	});
	const reading = $derived(media.current === null && media.shelfStatus !== 'ready');
	/** Its handle would not open it: the next press picks it instead. */
	let refused = $state<'denied' | 'missing' | null>(null);
	const progress = $derived(
		shown !== null && shown.durationMs > 0 ? Math.min(1, shown.positionMs / shown.durationMs) : 0
	);
	const width = $derived(`${String(progress * 100)}%`);

	async function open(): Promise<void> {
		const picked = await pickVideo(m['widget.media.picker_label']());
		if (picked === null) return;
		media.open(picked);
		onOpenDetail?.();
	}

	/** The last video again: from its handle when it has one, else the picker. */
	async function resume(): Promise<void> {
		const handle = media.last?.handle ?? null;
		if (handle === null || refused !== null) {
			await open();
			return;
		}
		const result = await reopen(handle);
		if (result.kind !== 'opened') {
			refused = result.kind;
			return;
		}
		media.open(result.file);
		onOpenDetail?.();
	}
</script>

{#if reading && media.shelfStatus === 'loading'}
	<div class="tp-media tp-media--state" aria-busy="true" aria-label={m['widget.media.loading']()}>
		<TpTideGauge size={roomy ? 32 : 20} animated level={0.35} />
	</div>
{:else if reading}
	<div class="tp-media tp-media--empty" role="alert" data-testid="media-error">
		<p>{m['widget.media.error']()}</p>
		<div class="tp-media__actions">
			<button type="button" class="tp-media__quiet" onclick={() => void media.refreshShelf()}>
				{m['common.retry']()}
			</button>
			<button
				type="button"
				class="tp-media__open"
				onclick={() => void open()}
				data-testid="media-tile-open"
			>
				{m['widget.media.open']()}
			</button>
		</div>
	</div>
{:else if shown === null}
	<div class="tp-media tp-media--empty" data-testid="media-empty">
		<TpIcon name="film" size={roomy ? 28 : 20} />
		<p>{m['widget.media.empty']()}</p>
		<button
			type="button"
			class="tp-media__open"
			onclick={() => void open()}
			data-testid="media-tile-open"
		>
			{m['widget.media.open']()}
		</button>
		{#if roomy}
			<p class="tp-media__note">{m['widget.media.local_note']()}</p>
		{/if}
	</div>
{:else}
	<div class="tp-media" data-testid="media-tile">
		<div class="tp-media__head">
			{#if shown.poster !== null && roomy}
				<img class="tp-media__still" src={shown.poster} alt="" data-testid="media-still" />
			{:else}
				<TpIcon name="film" size={20} />
			{/if}
			<!-- A file's name is text, never markup (CLAUDE.md rule 7). -->
			<p class="tp-media__name" title={shown.name}>{shown.name}</p>
		</div>
		<div class="tp-media__progress" aria-hidden="true">
			<span class="tp-media__bar"><span style:width></span></span>
			<span class="tp-num">
				{m['widget.media.time']({
					position: fmtDuration(shown.positionMs, settings.locale),
					duration: fmtDuration(shown.durationMs, settings.locale)
				})}
			</span>
		</div>
		<button
			type="button"
			class="tp-media__open"
			onclick={() => (shown.inHand ? onOpenDetail?.() : void resume())}
			data-testid="media-continue"
		>
			{m['widget.media.continue']()}
		</button>
		{#if refused !== null}
			<p class="tp-media__note" role="status" data-testid="media-tile-refused">
				{refused === 'denied'
					? m['widget.media.recent_denied']()
					: m['widget.media.recent_missing']()}
			</p>
		{:else if !shown.inHand && media.last?.handle === null && roomy}
			<p class="tp-media__note">{m['widget.media.pick_again']()}</p>
		{/if}
	</div>
{/if}

<style>
	.tp-media {
		display: flex;
		height: 100%;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-media--empty {
		align-items: flex-start;
	}

	.tp-media--state {
		align-items: center;
	}

	.tp-media__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.tp-media p {
		margin: 0;
	}

	.tp-media__head {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-fg);
	}

	.tp-media__still {
		flex: none;
		width: 48px;
		height: 27px;
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		object-fit: cover;
	}

	.tp-media__name {
		overflow: hidden;
		min-width: 0;
		flex: 1;
		font-size: var(--text-base);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-media__progress {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: var(--text-2xs);
	}

	.tp-media__bar {
		position: relative;
		overflow: hidden;
		height: 3px;
		flex: 1;
		border-radius: 999px;
		background: var(--color-ink-700);
	}

	.tp-media__bar > span {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--color-fg-mute);
	}

	.tp-media__note {
		font-size: var(--text-2xs);
	}

	button {
		align-self: flex-start;
		min-height: 36px;
		border: 1px solid var(--color-beacon);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		padding: 0 0.75rem;
	}

	.tp-media__quiet {
		border-color: var(--color-ink-700);
		color: var(--color-fg);
	}

	button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}
</style>
