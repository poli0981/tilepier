<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { player } from './player.svelte';

	/**
	 * Previous, play/pause and next (doc 09 §2), shared by the tile and the
	 * detail so the two can never disagree about what a press does.
	 *
	 * `onStart` is what play means when nothing is loaded yet — the tile and the
	 * detail both start the whole library from the top. Every press is a user
	 * gesture, which is the only way the player ever starts (doc 09 §2: never
	 * autoplay on load).
	 */
	interface Props {
		/** Without previous and next: the narrowest tile has room for one button. */
		compact?: boolean;
		iconSize?: number;
		onStart: () => void;
	}

	let { compact = false, iconSize = 18, onStart }: Props = $props();

	const sounding = $derived(player.status === 'playing' || player.status === 'loading');

	function toggle(): void {
		if (player.current === null) onStart();
		else player.toggle();
	}
</script>

<div class="tp-mtransport" class:tp-mtransport--compact={compact}>
	{#if !compact}
		<button
			type="button"
			aria-label={m['widget.music.previous']()}
			disabled={player.current === null}
			onclick={() => player.prev()}
			data-testid="music-prev"
		>
			<TpIcon name="prev" size={iconSize} />
		</button>
	{/if}
	<button
		type="button"
		class="tp-mtransport__main"
		aria-label={sounding ? m['widget.music.pause']() : m['widget.music.play']()}
		onclick={toggle}
		data-testid="music-toggle"
	>
		<TpIcon name={sounding ? 'pause' : 'play'} size={iconSize + 2} />
	</button>
	{#if !compact}
		<button
			type="button"
			aria-label={m['widget.music.next']()}
			disabled={!player.hasNext}
			onclick={() => player.next()}
			data-testid="music-next"
		>
			<TpIcon name="next" size={iconSize} />
		</button>
	{/if}
</div>

<style>
	.tp-mtransport {
		display: inline-flex;
		flex: none;
		align-items: center;
		gap: 0.125rem;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		/* 36 in a tile, as it was; 40 in the detail (doc 13 §8). */
		min-width: max(36px, var(--tp-target));
		min-height: max(36px, var(--tp-target));
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		padding: 0;
	}

	button:hover:not(:disabled) {
		background: var(--color-ink-700);
	}

	button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	button:disabled {
		color: var(--color-fg-dim);
		cursor: default;
	}

	/* doc 12 §5: one beacon per view — the play button is this one's. */
	.tp-mtransport__main {
		color: var(--color-beacon);
	}
</style>
