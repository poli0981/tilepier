<script lang="ts">
	import type { TpTileSize } from '$lib/core/types';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpTideGauge from '$lib/ui/TpTideGauge.svelte';
	import { collection } from './collection.svelte';
	import { player } from './player.svelte';
	import TpMusicLibraryActions from './TpMusicLibraryActions.svelte';

	/**
	 * The tile when there is nothing to play yet (doc 06 §3): `loading` (a
	 * skeleton, never a spinner), `error` (a card and a retry),
	 * `permission-needed` (a folder library the browser will not read until the
	 * reader allows it again — the card carries where playback was, and one
	 * click allows and resumes, Week 7 plan S11) and `empty` (how to add music,
	 * and that it never leaves the device). `TpMusicWidget` shows this instead of
	 * the player whenever its `showsState` says so; the branches here follow the
	 * same order.
	 */
	interface Props {
		size: TpTileSize;
		onOpenDetail?: (() => void) | undefined;
	}

	let { size, onOpenDetail }: Props = $props();

	const flat = $derived(size.h <= 1);
	const track = $derived(player.current);
</script>

{#if !collection.loaded}
	<div class="tp-mstate" aria-busy="true" aria-label={m['widget.music.loading']()}>
		<TpTideGauge size={flat ? 20 : 32} animated level={0.35} />
	</div>
{:else if collection.failed}
	<div class="tp-mstate" role="alert">
		<p>{m['widget.music.error']()}</p>
		<button type="button" class="tp-mstate__button" onclick={() => void collection.retry()}>
			{m['common.retry']()}
		</button>
	</div>
{:else if collection.needsRelink || player.status === 'permission'}
	<div class="tp-mstate" class:tp-mstate--flat={flat} data-testid="music-permission">
		<p class="tp-mstate__line">{m['widget.music.relink_title']()}</p>
		{#if track !== null && !flat}
			<p class="tp-num">
				{m['widget.music.resume']({
					title: track.title,
					position: fmtDuration(player.positionMs, settings.locale)
				})}
			</p>
		{/if}
		<button
			type="button"
			class="tp-mstate__button tp-mstate__button--primary"
			onclick={() => void collection.relink()}
			data-testid="music-relink"
		>
			{m['widget.music.relink']()}
		</button>
		{#if size.h >= 3}
			<p class="tp-mstate__hint">{m['widget.music.relink_hint']()}</p>
		{/if}
	</div>
{:else}
	<div class="tp-mstate" class:tp-mstate--flat={flat} data-testid="music-empty">
		{#if flat}
			<!-- No room for two buttons and a note: the detail has all three. -->
			<button
				type="button"
				class="tp-mstate__button tp-mstate__button--primary"
				onclick={() => onOpenDetail?.()}
			>
				{m['widget.music.add_files']()}
			</button>
		{:else}
			<p class="tp-mstate__line">{m['widget.music.empty']()}</p>
			<TpMusicLibraryActions compact showNote={size.h >= 3} />
		{/if}
	</div>
{/if}

<style>
	.tp-mstate {
		display: flex;
		height: 100%;
		flex-direction: column;
		align-items: flex-start;
		justify-content: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-mstate p {
		margin: 0;
	}

	.tp-mstate--flat {
		flex-direction: row;
		align-items: center;
	}

	.tp-mstate--flat .tp-mstate__line {
		overflow: hidden;
		flex: 1;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mstate__hint {
		font-size: var(--text-2xs);
	}

	.tp-mstate__button {
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

	.tp-mstate__button--primary {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	.tp-mstate__button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}
</style>
