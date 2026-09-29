<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';
	import { collection } from './collection.svelte';
	import { marquee } from './marquee';
	import { player } from './player.svelte';
	import { upNextId } from './service';
	import TpMusicCover from './TpMusicCover.svelte';
	import TpMusicLibraryActions from './TpMusicLibraryActions.svelte';
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
	 * because the manifest declares `fsa`):**
	 * - `loading` — the library is being read: a skeleton, never a spinner.
	 * - `error` — it could not be: a card and a retry.
	 * - `permission-needed` — a folder library the browser will not read until
	 *   the reader allows it again; the card carries where playback was, and one
	 *   click allows and resumes (Week 7 plan S11).
	 * - `empty` — no music: how to add some, and that it never leaves the device.
	 * - `ready` — the player.
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

{#if !collection.loaded}
	<div class="tp-music__state" aria-busy="true" aria-label={m['widget.music.loading']()}>
		<TpTideGauge size={flat ? 20 : 32} animated level={0.35} />
	</div>
{:else if collection.failed}
	<div class="tp-music__state" role="alert">
		<p>{m['widget.music.error']()}</p>
		<button type="button" class="tp-music__button" onclick={() => void collection.retry()}>
			{m['common.retry']()}
		</button>
	</div>
{:else if collection.needsRelink || player.status === 'permission'}
	<div class="tp-music__card" class:tp-music__card--flat={flat} data-testid="music-permission">
		<p class="tp-music__line">{m['widget.music.relink_title']()}</p>
		{#if track !== null && !flat}
			<p class="tp-music__resume tp-num">
				{m['widget.music.resume']({
					title: track.title,
					position: fmtDuration(player.positionMs, settings.locale)
				})}
			</p>
		{/if}
		<button
			type="button"
			class="tp-music__button tp-music__button--primary"
			onclick={() => void collection.relink()}
			data-testid="music-relink"
		>
			{m['widget.music.relink']()}
		</button>
		{#if size.h >= 3}
			<p class="tp-music__hint">{m['widget.music.relink_hint']()}</p>
		{/if}
	</div>
{:else if collection.tracks.length === 0 && collection.scanning === null}
	<div class="tp-music__card" class:tp-music__card--flat={flat} data-testid="music-empty">
		{#if flat}
			<!-- No room for two buttons and a note: the detail has all three. -->
			<button
				type="button"
				class="tp-music__button tp-music__button--primary"
				onclick={() => onOpenDetail?.()}
			>
				{m['widget.music.add_files']()}
			</button>
		{:else}
			<p class="tp-music__line">{m['widget.music.empty']()}</p>
			<TpMusicLibraryActions compact showNote={size.h >= 3} />
		{/if}
	</div>
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
	.tp-music__line,
	.tp-music__hint,
	.tp-music__resume {
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

	.tp-music__state,
	.tp-music__card {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-music__state p {
		margin: 0;
	}

	.tp-music__card--flat {
		flex-direction: row;
		align-items: center;
	}

	.tp-music__card--flat .tp-music__line {
		overflow: hidden;
		flex: 1;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-music__button {
		min-height: 36px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0 0.75rem;
	}

	.tp-music__button--primary {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	.tp-music__button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}
</style>
