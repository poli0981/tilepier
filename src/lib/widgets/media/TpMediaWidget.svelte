<script lang="ts">
	import type { TpWidgetProps } from '$lib/core/types';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { pickVideo } from './picker';
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
	 * **States (doc 06 §3, the music/media class):** `empty` and `ready`.
	 * `loading` and `error` belong to what is read back from storage, which
	 * arrives with resume; `stale`, `stale-error` and `offline` do not apply,
	 * nothing is fetched; and `permission-needed` does not either — the
	 * manifest declares no permissions.
	 */
	let { size, onOpenDetail }: TpWidgetProps = $props();

	const roomy = $derived(size.h >= 3);
	const progress = $derived(
		media.durationMs > 0 ? Math.min(1, media.positionMs / media.durationMs) : 0
	);
	const width = $derived(`${String(progress * 100)}%`);

	async function open(): Promise<void> {
		const picked = await pickVideo(m['widget.media.picker_label']());
		if (picked === null) return;
		media.open(picked);
		onOpenDetail?.();
	}
</script>

{#if media.current === null}
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
			<TpIcon name="film" size={20} />
			<!-- A file's name is text, never markup (CLAUDE.md rule 7). -->
			<p class="tp-media__name" title={media.current.name}>{media.current.name}</p>
		</div>
		<div class="tp-media__progress" aria-hidden="true">
			<span class="tp-media__bar"><span style:width></span></span>
			<span class="tp-num">
				{m['widget.media.time']({
					position: fmtDuration(media.positionMs, settings.locale),
					duration: fmtDuration(media.durationMs, settings.locale)
				})}
			</span>
		</div>
		<button
			type="button"
			class="tp-media__open"
			onclick={() => onOpenDetail?.()}
			data-testid="media-continue"
		>
			{m['widget.media.continue']()}
		</button>
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

	button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}
</style>
