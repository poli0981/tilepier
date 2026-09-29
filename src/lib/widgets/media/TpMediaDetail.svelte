<script lang="ts">
	import type { TpDetailProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { pickVideo } from './picker';
	import { media } from './store.svelte';
	import TpMediaPlayer from './TpMediaPlayer.svelte';

	/**
	 * doc 09 §3's detail: the video, large, with its controls — or, with none
	 * open, the one way to open one and the promise that it stays on the device.
	 *
	 * One player per file (`{#key}`): a new file is a new element, with no state
	 * of the last one's left over, and closing the detail ends the video and its
	 * picture-in-picture with it (owner decision Q2).
	 */
	let { instanceId: _instanceId }: TpDetailProps = $props();

	async function open(): Promise<void> {
		const picked = await pickVideo(m['widget.media.picker_label']());
		if (picked !== null) media.open(picked);
	}
</script>

<div class="tp-vdetail" data-testid="media-detail">
	{#if media.current === null}
		<div class="tp-vdetail__empty" data-testid="media-nothing">
			<TpIcon name="film" size={40} />
			<p>{m['widget.media.empty']()}</p>
			<button
				type="button"
				class="tp-vdetail__open"
				onclick={() => void open()}
				data-testid="media-open"
			>
				{m['widget.media.open']()}
			</button>
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
