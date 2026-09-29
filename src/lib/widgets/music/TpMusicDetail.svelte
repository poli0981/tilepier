<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpDetailProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { collection } from './collection.svelte';
	import { player } from './player.svelte';
	import TpMusicCover from './TpMusicCover.svelte';
	import TpMusicLibrary from './TpMusicLibrary.svelte';
	import TpMusicLibraryActions from './TpMusicLibraryActions.svelte';
	import TpMusicPlaylists from './TpMusicPlaylists.svelte';
	import TpMusicSeek from './TpMusicSeek.svelte';
	import TpMusicTransport from './TpMusicTransport.svelte';

	/**
	 * doc 09 §2's detail: what is playing, large, with every control the tile
	 * has no room for, and the library behind it.
	 *
	 * Closing the detail does not stop the music — the player is not in here
	 * (player.svelte.ts) — and the Media Session handlers belong to the player
	 * too, not to this component, which unmounts.
	 */
	let { instanceId: _instanceId }: TpDetailProps = $props();

	$effect(() => {
		// Shares the tile's reads; on a direct load of /w/music this is the first.
		untrack(() => {
			void collection.load();
			void player.restore();
		});
	});

	const track = $derived(player.current);

	const repeatLabel = $derived(
		player.repeat === 'off'
			? m['widget.music.repeat_off']()
			: player.repeat === 'all'
				? m['widget.music.repeat_all']()
				: m['widget.music.repeat_one']()
	);

	function startLibrary(): void {
		const first = collection.tracks[0];
		if (first === undefined) return;
		player.playTracks(
			collection.tracks.map((entry) => entry.id),
			first.id,
			{ kind: 'library' }
		);
	}
</script>

<div class="tp-mdetail" data-testid="music-detail">
	<section class="tp-mdetail__now" aria-label={m['widget.music.now_playing']()}>
		<TpMusicCover {track} size={200} />
		<div class="tp-mdetail__text">
			<h3 class="tp-mdetail__title">{track?.title ?? m['widget.music.nothing_playing']()}</h3>
			{#if track !== null}
				<p>{track.artist || m['widget.music.unknown_artist']()}</p>
				<p class="tp-mdetail__album">{track.album || m['widget.music.unknown_album']()}</p>
			{/if}
			{#if player.status === 'blocked'}
				<p class="tp-mdetail__hint" role="status">{m['widget.music.press_play']()}</p>
			{/if}
		</div>

		<TpMusicSeek />

		<div class="tp-mdetail__controls">
			<button
				type="button"
				class="tp-mdetail__toggle"
				aria-label={m['widget.music.shuffle']()}
				aria-pressed={player.shuffle}
				onclick={() => player.setShuffle(!player.shuffle)}
				data-testid="music-shuffle"
			>
				<TpIcon name="shuffle" size={18} />
			</button>
			<TpMusicTransport iconSize={22} onStart={startLibrary} />
			<button
				type="button"
				class="tp-mdetail__toggle"
				aria-label={repeatLabel}
				aria-pressed={player.repeat !== 'off'}
				onclick={() => player.cycleRepeat()}
				data-testid="music-repeat"
			>
				<TpIcon name={player.repeat === 'one' ? 'repeat-one' : 'repeat'} size={18} />
			</button>
			<label class="tp-mdetail__volume">
				<TpIcon name={player.volume === 0 ? 'mute' : 'volume'} size={16} />
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={player.volume}
					aria-label={m['widget.music.volume']()}
					oninput={(event) => player.setVolume(Number(event.currentTarget.value))}
				/>
			</label>
		</div>
	</section>

	<div class="tp-mdetail__library">
		<TpMusicLibraryActions />
		{#if collection.tracks.length > 0}
			<TpMusicPlaylists />
			<TpMusicLibrary />
		{/if}
	</div>
</div>

<style>
	.tp-mdetail {
		display: grid;
		gap: 1.5rem;
		grid-template-columns: minmax(0, 22rem) minmax(0, 1fr);
	}

	@media (max-width: 767px) {
		.tp-mdetail {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	.tp-mdetail__now {
		display: flex;
		min-width: 0;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.tp-mdetail__text {
		width: 100%;
		min-width: 0;
		text-align: center;
	}

	.tp-mdetail__text p,
	.tp-mdetail__title {
		overflow: hidden;
		margin: 0;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mdetail__title {
		color: var(--color-fg);
		font-size: var(--text-lg);
		font-weight: 600;
	}

	.tp-mdetail__text p {
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-mdetail__album {
		color: var(--color-fg-dim);
	}

	.tp-mdetail__hint {
		margin-top: 0.5rem;
	}

	.tp-mdetail__now :global(.tp-mseek) {
		width: 100%;
	}

	.tp-mdetail__controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
	}

	.tp-mdetail__toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 40px;
		min-height: 40px;
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
	}

	.tp-mdetail__toggle[aria-pressed='true'] {
		color: var(--color-fg);
		background: var(--color-ink-700);
	}

	.tp-mdetail__toggle:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	.tp-mdetail__volume {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--color-fg-mute);
	}

	.tp-mdetail__volume input {
		width: 6rem;
		accent-color: var(--color-fg-mute);
	}

	.tp-mdetail__library {
		display: flex;
		min-width: 0;
		flex-direction: column;
		gap: 1rem;
	}
</style>
