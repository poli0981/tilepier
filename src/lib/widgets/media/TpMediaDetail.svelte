<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { pickVideo } from './picker';
	import { media } from './store.svelte';
	import TpMediaPlayer from './TpMediaPlayer.svelte';
	import TpMediaRecents from './TpMediaRecents.svelte';

	/**
	 * doc 09 §3's detail: the video, large, with its controls — or, with none
	 * open, the one way to open one and the promise that it stays on the device.
	 *
	 * One player per file (`{#key}`): a new file is a new element, with no state
	 * of the last one's left over, and closing the detail ends the video and its
	 * picture-in-picture with it (owner decision Q2).
	 *
	 * **A reload lands here**, on `/w/media`, with the file gone from memory. So
	 * with nothing open the detail offers what the tile does: the videos opened
	 * lately through the picker (`TpMediaRecents`), which open again from their
	 * handles, and the last video worth coming back to when it is not one of
	 * them — picked again, it finds its place.
	 */
	let { instanceId: _instanceId }: TpDetailProps = $props();

	$effect(() => {
		// Read once per page and shared with the tile; this page may have none.
		untrack(() => void media.loadShelf());
	});

	async function open(): Promise<void> {
		const picked = await pickVideo(m['widget.media.picker_label']());
		if (picked !== null) media.open(picked);
	}
</script>

<div class="tp-vdetail" data-testid="media-detail">
	{#if media.current === null}
		<div class="tp-vdetail__empty" data-testid="media-nothing">
			<TpIcon name="film" size={40} />
			{#if media.last === null || media.last.handle !== null}
				{#if media.recents.length === 0}
					<p>{m['widget.media.empty']()}</p>
				{/if}
				<button
					type="button"
					class="tp-vdetail__open"
					onclick={() => void open()}
					data-testid="media-open"
				>
					{m['widget.media.open']()}
				</button>
			{:else}
				<div class="tp-vdetail__last" data-testid="media-last">
					<!-- A file's name is text, never markup (CLAUDE.md rule 7). -->
					<p class="tp-vdetail__title" title={media.last.name}>{media.last.name}</p>
					<p class="tp-num">
						{m['widget.media.time']({
							position: fmtDuration(media.last.positionMs, settings.locale),
							duration: fmtDuration(media.last.durationMs, settings.locale)
						})}
					</p>
				</div>
				<p class="tp-vdetail__note">{m['widget.media.pick_again']()}</p>
				<div class="tp-vdetail__actions">
					<button
						type="button"
						class="tp-vdetail__open"
						onclick={() => void open()}
						data-testid="media-last-continue"
					>
						{m['widget.media.continue']()}
					</button>
					<button type="button" onclick={() => void open()} data-testid="media-open">
						{m['widget.media.open_another']()}
					</button>
				</div>
			{/if}
			{#if media.recents.length > 0}
				<TpMediaRecents />
			{/if}
			<p class="tp-vdetail__note">{m['widget.media.local_note']()}</p>
		</div>
	{:else}
		{#key media.current}
			<TpMediaPlayer file={media.current} />
		{/key}
		<div class="tp-vdetail__bar">
			<!-- A file's name is text, never markup (CLAUDE.md rule 7). -->
			<p class="tp-vdetail__name" title={media.current.name}>{media.current.name}</p>
			<button type="button" onclick={() => void open()} data-testid="media-open-another">
				{m['widget.media.open_another']()}
			</button>
		</div>
	{/if}
</div>

<style>
	.tp-vdetail {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.tp-vdetail__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		color: var(--color-fg-mute);
		padding: 2rem 1rem;
		text-align: center;
	}

	.tp-vdetail__empty p,
	.tp-vdetail__bar p {
		margin: 0;
	}

	.tp-vdetail__note {
		font-size: var(--text-xs);
	}

	.tp-vdetail__last {
		display: flex;
		max-width: 100%;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
	}

	.tp-vdetail__last p {
		margin: 0;
	}

	/* Not the bar's name: in a column, `flex: 1` with `overflow: hidden`
	   would let it shrink to nothing. */
	.tp-vdetail__title {
		overflow: hidden;
		max-width: 100%;
		color: var(--color-fg);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-vdetail__actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 0.5rem;
	}

	.tp-vdetail__bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.tp-vdetail__name {
		overflow: hidden;
		min-width: 0;
		flex: 1;
		color: var(--color-fg);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	button {
		min-height: 40px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		padding: 0 0.875rem;
	}

	.tp-vdetail__open {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}
</style>
