<script lang="ts">
	import { db as defaultDb, type TpDb, type TpTrack } from '$lib/core/storage/db';
	import { monogramOf } from '$lib/i18n/monogram';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';

	/**
	 * A track's cover (doc 09 §2), or its first letter on a token colour when it
	 * has none — the rss feed's monogram, graduated to `i18n/monogram.ts` at this
	 * second use. With no track at all, the music glyph.
	 *
	 * Decorative: the title always stands beside it, so the image has no text
	 * alternative of its own and is hidden from assistive technology.
	 */
	interface Props {
		track: TpTrack | null;
		/** Edge length in pixels. */
		size: number;
		/** Test seam: the covers' Dexie. */
		db?: TpDb | undefined;
	}

	let { track, size, db = undefined }: Props = $props();

	let url = $state<string | null>(null);
	const coverId = $derived(track?.coverId);
	const edge = $derived(`${size}px`);

	$effect(() => {
		// Turns the stored cover into an object URL for the <img>, and revokes it
		// when the cover changes or this goes, so a long listening session does
		// not collect them. A local Dexie read, not a fetch (CLAUDE.md rule 6).
		const id = coverId;
		const target = db ?? defaultDb;
		url = null;
		if (id === undefined) return;

		let cancelled = false;
		let made: string | null = null;
		target.trackBlobs
			.get(id)
			.then((row) => {
				if (cancelled || row === undefined) return;
				made = URL.createObjectURL(row.blob);
				url = made;
			})
			.catch(() => undefined);

		return () => {
			cancelled = true;
			if (made !== null) URL.revokeObjectURL(made);
		};
	});
</script>

<span class="tp-mcover" style:--tp-mcover-size={edge} aria-hidden="true">
	{#if url !== null}
		<img src={url} alt="" draggable="false" />
	{:else if track !== null}
		<span class="tp-mcover__letter">{monogramOf(track.title, settings.locale)}</span>
	{:else}
		<TpIcon name="music" size={Math.round(size * 0.45)} />
	{/if}
</span>

<style>
	.tp-mcover {
		display: inline-flex;
		flex: none;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		width: var(--tp-mcover-size);
		height: var(--tp-mcover-size);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-700);
		color: var(--color-fg-mute);
	}

	img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.tp-mcover__letter {
		color: var(--color-fg-mute);
		font-size: calc(var(--tp-mcover-size) * 0.42);
		font-weight: 600;
		line-height: 1;
	}
</style>
