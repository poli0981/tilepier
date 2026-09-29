<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { forgetAllVideos, forgetVideo, reopen } from './recents';
	import { media, type TpShelfItem } from './store.svelte';

	/**
	 * The videos opened lately through the picker (doc 09 §3; the owner's
	 * decision: automatic, at most five, each with a way to forget it) — for
	 * the detail with nothing open.
	 *
	 * **Opening one asks the browser first**, in the click: a handle is a way
	 * back to the file, not the file, and the permission it had ended with the
	 * last visit. A refusal, or a file that has moved, is said beside the row,
	 * which keeps its Forget.
	 *
	 * Forgetting takes the video's recent, its place and its still together
	 * (`recents.ts`), and the shelf is read again.
	 */
	const trouble = new SvelteMap<string, 'denied' | 'missing'>();

	async function open(item: TpShelfItem): Promise<void> {
		if (item.handle === null) return;
		const result = await reopen(item.handle);
		if (result.kind === 'opened') media.open(result.file);
		else trouble.set(item.key, result.kind);
	}

	async function forget(item: TpShelfItem): Promise<void> {
		try {
			await forgetVideo(item.key);
		} finally {
			trouble.delete(item.key);
			await media.refreshShelf();
		}
	}

	async function forgetAll(): Promise<void> {
		try {
			await forgetAllVideos();
		} finally {
			trouble.clear();
			await media.refreshShelf();
		}
	}
</script>

<section class="tp-recents" aria-labelledby="tp-recents-title" data-testid="media-recents">
	<h3 id="tp-recents-title">{m['widget.media.recents']()}</h3>
	<ul>
		{#each media.recents as item (item.key)}
			<li data-testid="media-recent">
				<button
					type="button"
					class="tp-recents__open"
					aria-label={m['widget.media.open_recent']({ name: item.name })}
					onclick={() => void open(item)}
				>
					{#if item.poster !== null}
						<img src={item.poster} alt="" width="64" height="36" />
					{:else}
						<span class="tp-recents__blank"><TpIcon name="film" size={18} /></span>
					{/if}
					<!-- A file's name is text, never markup (CLAUDE.md rule 7). -->
					<span class="tp-recents__name">{item.name}</span>
					{#if item.durationMs > 0}
						<span class="tp-recents__time tp-num">
							{m['widget.media.time']({
								position: fmtDuration(item.positionMs, settings.locale),
								duration: fmtDuration(item.durationMs, settings.locale)
							})}
						</span>
					{/if}
				</button>
				<button
					type="button"
					class="tp-recents__forget"
					aria-label={m['widget.media.forget_named']({ name: item.name })}
					onclick={() => void forget(item)}
					data-testid="media-recent-forget"
				>
					{m['widget.media.forget']()}
				</button>
				{#if trouble.has(item.key)}
					<p class="tp-recents__note" role="status" data-testid="media-recent-trouble">
						{trouble.get(item.key) === 'denied'
							? m['widget.media.recent_denied']()
							: m['widget.media.recent_missing']()}
					</p>
				{/if}
			</li>
		{/each}
	</ul>
	<div class="tp-recents__foot">
		<p>{m['widget.media.recent_note']()}</p>
		<button
			type="button"
			class="tp-recents__forget"
			onclick={() => void forgetAll()}
			data-testid="media-recents-forget-all"
		>
			{m['widget.media.forget_all']()}
		</button>
	</div>
</section>

<style>
	.tp-recents {
		display: flex;
		width: 100%;
		max-width: 32rem;
		flex-direction: column;
		gap: 0.5rem;
		text-align: left;
	}

	h3 {
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	li {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 0.25rem 0.5rem;
	}

	.tp-recents__open {
		display: flex;
		min-width: 0;
		min-height: 44px;
		align-items: center;
		gap: 0.625rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		padding: 0.25rem 0.5rem;
		text-align: left;
	}

	img,
	.tp-recents__blank {
		flex: none;
		width: 64px;
		height: 36px;
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		object-fit: cover;
	}

	.tp-recents__blank {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		color: var(--color-fg-mute);
	}

	.tp-recents__name {
		overflow: hidden;
		min-width: 0;
		flex: 1;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-recents__time {
		flex: none;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-recents__forget {
		min-height: 40px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0 0.75rem;
	}

	.tp-recents__note {
		grid-column: 1 / -1;
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-recents__foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-recents__foot p {
		margin: 0;
	}

	button:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}
</style>
