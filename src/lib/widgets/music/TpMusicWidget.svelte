<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import { collection } from './collection.svelte';
	import { marquee } from './marquee';
	import { player } from './player.svelte';
	import { upNextId } from './service';
	import TpMusicCover from './TpMusicCover.svelte';
	import TpMusicTileState from './TpMusicTileState.svelte';
	import TpMusicTransport from './TpMusicTransport.svelte';

	/**
	 * doc 09 §2's tile: the cover, the title, the progress and the transport, and
	 * the next track once there is a second row for it.
	 *
	 * **Laid out by `w` and `h`, not by tier name** (doc 13 §3, 2026-09-29): the
	 * host calls 4×2 — this widget's default — tier L, which is not the shape L
	 * means in the doc. So: one row at `h = 1`, with only play/pause at 2×1;
	 * progress and the next track from `h = 2`; a larger cover at `h = 3`.
	 *
	 * **States (doc 06 §3, the music/media class, plus `permission-needed`
	 * because the manifest declares `fsa`):** `ready` is this component;
	 * `loading`, `error`, `permission-needed` and `empty` are `TpMusicTileState`.
	 * `stale`, `stale-error` and `offline` do not apply: nothing here is fetched.
	 */
	let { size, onOpenDetail }: TpWidgetProps = $props();

	$effect(() => {
		// The library and where the player was, read once per page and shared
		// with the detail through their stores.
		untrack(() => {
			void collection.load();
			void player.restore();
		});
	});

	const track = $derived(player.current);

	/** Anything but the player itself — see `TpMusicTileState`. An empty library
	 *  stays in its state through a first scan: its tracks arrive only when the
	 *  scan is done, and until then a play button would have nothing to play. */
	const showsState = $derived(
		!collection.loaded ||
			collection.failed ||
			collection.needsRelink ||
			player.status === 'permission' ||
			collection.tracks.length === 0
	);
	const flat = $derived(size.h <= 1);
	const tiny = $derived(flat && size.w <= 2);
	const coverSize = $derived(size.h >= 3 ? 88 : size.h >= 2 ? 52 : 30);

	const subtitle = $derived(
		track === null
			? m['widget.music.track_count']({ count: collection.tracks.length })
			: track.artist || m['widget.music.unknown_artist']()
	);

	const upNext = $derived.by(() => {
		const id = upNextId(player.queue, player.repeat);
		return id === undefined ? null : (collection.tracks.find((entry) => entry.id === id) ?? null);
	});

	const progress = $derived(
		player.durationMs > 0 ? Math.min(1, player.positionMs / player.durationMs) : 0
	);

	/** Play with nothing loaded means the whole library, from the top. */
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

{#if showsState}
	<TpMusicTileState {size} {onOpenDetail} />
{:else}
	<div class="tp-music" class:tp-music--flat={flat} data-testid="music-tile">
		<div class="tp-music__main">
			{#if !tiny}
				<TpMusicCover {track} size={coverSize} />
			{/if}
			<div class="tp-music__text">
				<p class="tp-music__title tp-marquee" title={track?.title} {@attach marquee}>
					<span>{track?.title ?? m['widget.music.nothing_playing']()}</span>
				</p>
				{#if !flat}
					<p class="tp-music__subtitle tp-marquee" {@attach marquee}><span>{subtitle}</span></p>
				{/if}
				{#if player.status === 'blocked' && !tiny}
					<p class="tp-music__hint">{m['widget.music.press_play']()}</p>
				{/if}
			</div>
			<TpMusicTransport compact={tiny} iconSize={flat ? 16 : 18} onStart={startLibrary} />
		</div>

		{#if !flat}
			<div class="tp-music__progress" aria-hidden="true">
				<span class="tp-num">{fmtDuration(player.positionMs, settings.locale)}</span>
				<span class="tp-music__bar"><span style:width="{progress * 100}%"></span></span>
				<span class="tp-num">{fmtDuration(player.durationMs, settings.locale)}</span>
			</div>
			{#if upNext !== null}
				<p class="tp-music__next tp-marquee" {@attach marquee}>
					<span>{m['widget.music.up_next']({ title: upNext.title })}</span>
				</p>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.tp-music {
		display: flex;
		height: 100%;
		min-width: 0;
		flex-direction: column;
		justify-content: center;
		gap: 0.375rem;
	}

	.tp-music__main {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.625rem;
	}

	.tp-music__text {
		display: flex;
		min-width: 0;
		flex: 1;
		flex-direction: column;
		gap: 0.125rem;
	}

	.tp-music__title,
	.tp-music__subtitle,
	.tp-music__next,
	.tp-music__hint {
		margin: 0;
	}

	.tp-music__title {
		color: var(--color-fg);
		font-size: var(--text-base);
		font-weight: 600;
	}

	.tp-music--flat .tp-music__title {
		font-size: var(--text-xs);
	}

	.tp-music__subtitle,
	.tp-music__next {
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-music__hint {
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	/* One line that ends in an ellipsis, and slides when motion is welcome and
	   the text does not fit (marquee.ts). */
	.tp-marquee {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	:global(:root[data-motion='ok']) .tp-marquee:global([data-overflow='true']) {
		text-overflow: clip;
	}

	:global(:root[data-motion='ok']) .tp-marquee:global([data-overflow='true']) > span {
		display: inline-block;
		animation: tp-marquee 9s ease-in-out infinite alternate;
	}

	@keyframes tp-marquee {
		0%,
		15% {
			transform: translateX(0);
		}
		85%,
		100% {
			transform: translateX(var(--tp-marquee-shift, 0));
		}
	}

	.tp-music__progress {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-music__bar {
		position: relative;
		overflow: hidden;
		height: 3px;
		flex: 1;
		border-radius: 999px;
		background: var(--color-ink-700);
	}

	.tp-music__bar > span {
		position: absolute;
		inset: 0 auto 0 0;
		background: var(--color-fg-mute);
	}
</style>
