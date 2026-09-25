<script lang="ts">
	import { untrack } from 'svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtDate, fmtRelative, fmtTime } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpFeedHtml from '$lib/ui/TpFeedHtml.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { problemText, troubleText } from './labels';
	import { TpFeedSources } from './sources.svelte';
	import TpRssAddFeed from './TpRssAddFeed.svelte';
	import TpRssFeedSource from './TpRssFeedSource.svelte';
	import {
		feedName,
		hostOf,
		mergeItems,
		monogramOf,
		moveFeed,
		readSettings,
		removeFeed,
		troubleOf,
		type TpFeedView
	} from './service';
	import { MAX_FEEDS } from './types';

	/**
	 * doc 08 §4's detail: three panes on a wide screen — the feeds, the merged
	 * list, the reader — and stacked on a narrow one, where the list and the
	 * reader take turns and the feeds fold behind a toggle.
	 *
	 * **Its own sources.** The detail can open from `/w/<id>` with no tile on the
	 * deck, so it subscribes to every feed itself. With the tile mounted too, the
	 * two share each `swr` entry and each scheduler entry (same key, same id), so
	 * opening the detail costs no request of its own.
	 *
	 * **Opening it is what "read" means** (doc 08 §4). The watermark moves to now
	 * as the detail opens, which clears the tile's dots; the detail itself keeps
	 * marking what was new *when it opened*, so the reader can still see which
	 * stories arrived since last time while reading them.
	 *
	 * The reader renders the summary through `TpFeedHtml`, which sanitises inside
	 * itself — the second of the app's two `{@html}` (doc 15 §4). "Open original"
	 * is the primary action: a feed's summary is a teaser at most, cut to 2 KB by
	 * the Worker.
	 */
	interface Props extends TpDetailProps {
		/** Test seam: a throwaway Dexie. */
		db?: TpDb | undefined;
	}

	let { instanceId, settings: tileSettings, onUpdateSettings, db = undefined }: Props = $props();

	const prefs = $derived(readSettings(tileSettings));
	const sources = new TpFeedSources(() => prefs.feeds);
	const views = $derived(sources.views(prefs.feeds));

	/** The watermark as it stood when the detail opened — what "new" means for
	 *  this visit, after the stored one has moved on. */
	const seenBefore = untrack(() => prefs.lastOpenedAt);

	// Moves the stored watermark to now, once, as the detail opens. Untracked:
	// its own write changes `prefs`, and a tracked read would write again.
	$effect(() => {
		untrack(() => {
			if (prefs.feeds.length > 0) onUpdateSettings?.({ lastOpenedAt: Date.now() });
		});
	});

	/** A feed URL to show alone, or `null` for all of them. */
	let filter = $state<string | null>(null);
	/** The story in the reader, by its list key. */
	let selected = $state<string | null>(null);
	/** Narrow layout only: whether the feed manager is unfolded. */
	let showFeeds = $state(false);

	/** Every item a full feed set can hold: ten feeds of thirty. */
	const DETAIL_ITEMS = MAX_FEEDS * 30;

	const shown = $derived(filter === null ? views : views.filter((view) => view.url === filter));
	const entries = $derived(mergeItems(shown, seenBefore, DETAIL_ITEMS));
	const entry = $derived(entries.find((candidate) => candidate.key === selected) ?? null);

	let now = $state(Date.now());
	$effect(() => {
		// Keeps each line's age honest while the detail stays open.
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	function ageOf(at: number): string {
		return fmtRelative(at, settings.locale, now);
	}

	function stampOf(at: number): string {
		return m['widget.rss.published_at']({
			date: fmtDate(at, settings.locale),
			time: fmtTime(at, settings.locale, { hour12: !settings.clock24h })
		});
	}

	function titleOf(title: string): string {
		return title === '' ? m['widget.rss.untitled']() : title;
	}

	function viewOf(url: string): TpFeedView | undefined {
		return views.find((view) => view.url === url);
	}

	function nameOf(url: string): string {
		const view = viewOf(url);
		return view === undefined ? hostOf(url) : feedName(view);
	}

	function pick(url: string | null): void {
		filter = url;
		selected = null;
	}

	/** Adding keeps the watermark: a feed added here was added while reading. */
	function add(feeds: string[]): void {
		onUpdateSettings?.({ feeds, lastOpenedAt: prefs.lastOpenedAt ?? Date.now() });
	}

	function remove(url: string): void {
		if (filter === url) pick(null);
		onUpdateSettings?.({ feeds: removeFeed(prefs.feeds, url) });
	}

	function move(url: string, delta: -1 | 1): void {
		onUpdateSettings?.({ feeds: moveFeed(prefs.feeds, url, delta) });
	}
</script>

{#each prefs.feeds as url (url)}
	{@const hash = sources.hashes.get(url)}
	{#if hash !== undefined}
		<TpRssFeedSource
			{instanceId}
			{url}
			{hash}
			{db}
			onHandle={sources.onHandle}
			onGone={sources.onGone}
		/>
	{/if}
{/each}

<div class="tp-rssd">
	<div class="tp-rssd__panes" data-reading={entry !== null}>
		<section class="tp-rssd__feeds" data-open={showFeeds} aria-labelledby="{instanceId}-rssd-feeds">
			<div class="tp-rssd__feeds-head">
				<h3 id="{instanceId}-rssd-feeds" class="tp-rssd__heading">
					{m['widget.rss.feeds_heading']({ count: prefs.feeds.length, max: MAX_FEEDS })}
				</h3>
				<button
					type="button"
					class="tp-rssd__fold"
					aria-expanded={showFeeds}
					onclick={() => (showFeeds = !showFeeds)}
				>
					{showFeeds ? m['widget.rss.hide_feeds']() : m['widget.rss.show_feeds']()}
				</button>
			</div>

			<div class="tp-rssd__feeds-body">
				{#if prefs.feeds.length === 0}
					<p class="tp-rssd__note">{m['widget.rss.no_feeds']()}</p>
				{:else}
					<ul class="tp-rssd__feedlist">
						<li class="tp-rssd__feed">
							<button
								type="button"
								class="tp-rssd__pick"
								aria-pressed={filter === null}
								onclick={() => pick(null)}
							>
								<span class="tp-rssd__mono" aria-hidden="true"><TpIcon name="rss" size={10} /></span
								>
								<span class="tp-rssd__name">{m['widget.rss.all_feeds']()}</span>
							</button>
						</li>
						{#each prefs.feeds as url, index (url)}
							{@const view = viewOf(url)}
							{@const name = nameOf(url)}
							{@const trouble = view === undefined ? null : troubleOf(view)}
							<li class="tp-rssd__feed" data-testid="rssd-feed">
								<button
									type="button"
									class="tp-rssd__pick"
									aria-pressed={filter === url}
									onclick={() => pick(url)}
								>
									<span class="tp-rssd__mono" aria-hidden="true"
										>{monogramOf(name, settings.locale)}</span
									>
									<span class="tp-rssd__name" lang={view?.feed?.lang ?? ''}>{name}</span>
									{#if trouble !== null}
										<span class="tp-rssd__chip" title={troubleText(name, trouble, ageOf)}>
											{problemText(trouble)}
										</span>
									{/if}
								</button>
								<span class="tp-rssd__tools">
									{#if trouble !== null && trouble.kind !== 'unavailable'}
										<button
											type="button"
											class="tp-rssd__tool"
											aria-label={m['widget.rss.retry_feed']({ feed: name })}
											title={m['widget.rss.retry_feed']({ feed: name })}
											onclick={() => sources.retryOne(url)}
										>
											<TpIcon name="refresh" size={12} />
										</button>
									{/if}
									<button
										type="button"
										class="tp-rssd__tool tp-rssd__tool--up"
										aria-label={m['widget.rss.move_up']({ feed: name })}
										title={m['widget.rss.move_up']({ feed: name })}
										disabled={index === 0}
										onclick={() => move(url, -1)}
									>
										<TpIcon name="chevron" size={12} />
									</button>
									<button
										type="button"
										class="tp-rssd__tool"
										aria-label={m['widget.rss.move_down']({ feed: name })}
										title={m['widget.rss.move_down']({ feed: name })}
										disabled={index === prefs.feeds.length - 1}
										onclick={() => move(url, 1)}
									>
										<TpIcon name="chevron" size={12} />
									</button>
									<button
										type="button"
										class="tp-rssd__tool"
										aria-label={m['widget.rss.remove_feed']({ feed: name })}
										title={m['widget.rss.remove_feed']({ feed: name })}
										onclick={() => remove(url)}
									>
										<TpIcon name="trash" size={12} />
									</button>
								</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if prefs.feeds.length < MAX_FEEDS}
					<TpRssAddFeed feeds={prefs.feeds} onAdd={add} id="{instanceId}-rssd-add" />
				{/if}
			</div>
		</section>

		<section class="tp-rssd__list" aria-labelledby="{instanceId}-rssd-stories">
			<h3 id="{instanceId}-rssd-stories" class="tp-rssd__heading">
				{filter === null ? m['widget.rss.stories_heading']() : nameOf(filter)}
			</h3>
			{#if entries.length === 0}
				<p class="tp-rssd__note">
					{prefs.feeds.length === 0
						? m['widget.rss.nothing_yet']()
						: m['widget.rss.stories_none']()}
				</p>
			{:else}
				<ul class="tp-rssd__stories" data-testid="rssd-stories">
					{#each entries as story (story.key)}
						<li>
							<button
								type="button"
								class="tp-rssd__story"
								aria-current={selected === story.key ? 'true' : undefined}
								onclick={() => (selected = story.key)}
							>
								<span class="tp-rssd__story-head">
									{#if story.unread}
										<span class="tp-rssd__dot" role="img" aria-label={m['widget.rss.unread']()}
										></span>
									{/if}
									<span class="tp-rssd__story-title" lang={story.lang}
										>{titleOf(story.item.title)}</span
									>
								</span>
								<span class="tp-rssd__meta">
									<span class="tp-rssd__mono" aria-hidden="true"
										>{monogramOf(story.feedName, settings.locale)}</span
									>
									<span class="tp-rssd__source" lang={story.lang}>{story.feedName}</span>
									<span>{story.dated ? ageOf(story.at) : m['widget.rss.undated']()}</span>
								</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<article class="tp-rssd__reader" data-testid="rssd-reader">
			{#if entry === null}
				<p class="tp-rssd__note">{m['widget.rss.pick_story']()}</p>
			{:else}
				<button type="button" class="tp-rssd__back" onclick={() => (selected = null)}>
					{m['widget.rss.back_to_list']()}
				</button>
				<h3 class="tp-rssd__title" lang={entry.lang}>{titleOf(entry.item.title)}</h3>
				<p class="tp-rssd__byline">
					<span lang={entry.lang}>{entry.feedName}</span>
					{#if entry.item.author !== null}
						<span lang={entry.lang}>{entry.item.author}</span>
					{/if}
					{#if entry.dated}
						<time datetime={new Date(entry.at).toISOString()} title={stampOf(entry.at)}
							>{ageOf(entry.at)}</time
						>
					{:else}
						<span>{m['widget.rss.undated']()}</span>
					{/if}
				</p>
				{#if entry.link !== null}
					<!-- An absolute http(s) URL off the feed (`openableLink`), not a route
					     of this app: nothing to resolve(). -->
					<!-- eslint-disable svelte/no-navigation-without-resolve -->
					<a
						class="tp-rssd__open"
						href={entry.link}
						target="_blank"
						rel="noopener noreferrer"
						data-testid="rssd-open">{m['widget.rss.open_original']()}</a
					>
					<!-- eslint-enable svelte/no-navigation-without-resolve -->
				{/if}
				{#if entry.item.summaryHtml.trim() !== ''}
					<TpFeedHtml
						source={entry.item.summaryHtml}
						lang={entry.lang}
						label={m['widget.rss.summary_label']()}
					/>
				{:else}
					<p class="tp-rssd__note">{m['widget.rss.no_summary']()}</p>
				{/if}
			{/if}
		</article>
	</div>
</div>

<style>
	/* The container the panes are laid out against: the overlay's body on a
	   desk, the whole screen on a phone (doc 13 §6). */
	.tp-rssd {
		height: 100%;
		min-height: 0;
		container-type: inline-size;
	}

	.tp-rssd__panes {
		display: grid;
		height: 100%;
		min-height: 0;
		grid-template-columns: minmax(12rem, 15rem) minmax(15rem, 1fr) minmax(0, 1.35fr);
		gap: 1.25rem;
	}

	.tp-rssd__feeds,
	.tp-rssd__list,
	.tp-rssd__reader {
		min-height: 0;
		overflow-y: auto;
	}

	.tp-rssd__heading {
		margin: 0 0 0.5rem;
		color: var(--color-fg);
		font-size: var(--text-xs);
		font-weight: 600;
		letter-spacing: 0.02em;
		text-transform: uppercase;
	}

	.tp-rssd__feeds-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	/* The fold is a narrow-screen control; on a wide one the feeds are a pane. */
	.tp-rssd__fold {
		display: none;
	}

	.tp-rssd__feeds-body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.tp-rssd__feedlist,
	.tp-rssd__stories {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-rssd__feed {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.tp-rssd__pick,
	.tp-rssd__story {
		display: flex;
		width: 100%;
		min-width: 0;
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		text-align: left;
	}

	.tp-rssd__pick {
		align-items: center;
		gap: 0.5rem;
		padding: 0.3rem 0.375rem;
		font-size: var(--text-xs);
	}

	.tp-rssd__pick[aria-pressed='true'],
	.tp-rssd__story[aria-current='true'] {
		background: var(--color-beacon-soft);
		color: var(--color-fg);
	}

	.tp-rssd__pick:hover,
	.tp-rssd__story:hover {
		background: var(--color-ink-900);
	}

	.tp-rssd__pick:focus-visible,
	.tp-rssd__story:focus-visible,
	.tp-rssd__tool:focus-visible,
	.tp-rssd__back:focus-visible,
	.tp-rssd__fold:focus-visible,
	.tp-rssd__open:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	.tp-rssd__name,
	.tp-rssd__source {
		overflow: hidden;
		min-width: 0;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-rssd__name {
		flex: 1;
	}

	/* The feed's letter: the tile's monogram at the detail's size. */
	.tp-rssd__mono {
		display: inline-flex;
		width: 1.125rem;
		height: 1.125rem;
		flex: none;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		background: var(--color-ink-700);
		color: var(--color-fg);
		font-size: 0.6875rem;
		font-weight: 600;
		line-height: 1;
	}

	.tp-rssd__chip {
		flex: none;
		border: 1px solid var(--color-warn);
		border-radius: 999px;
		color: var(--color-warn);
		font-size: var(--text-2xs);
		padding: 0 0.375rem;
	}

	.tp-rssd__tools {
		display: inline-flex;
		flex: none;
	}

	.tp-rssd__tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg-dim);
		cursor: pointer;
		padding: 0.25rem;
	}

	.tp-rssd__tool:hover:not(:disabled) {
		color: var(--color-fg);
	}

	.tp-rssd__tool:disabled {
		cursor: default;
		opacity: 0.35;
	}

	/* `chevron` points down; up is the same glyph turned over, as the
	   currency detail does it. */
	.tp-rssd__tool--up :global(svg) {
		rotate: 180deg;
	}

	.tp-rssd__story {
		flex-direction: column;
		gap: 0.2rem;
		padding: 0.45rem 0.5rem;
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.tp-rssd__story-head {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
	}

	.tp-rssd__story-title {
		color: var(--color-fg);
		overflow-wrap: anywhere;
	}

	.tp-rssd__dot {
		width: 0.375rem;
		height: 0.375rem;
		flex: none;
		align-self: center;
		border-radius: 999px;
		background: var(--color-beacon);
	}

	.tp-rssd__meta {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.375rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-rssd__reader {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.75rem;
		padding-right: 0.25rem;
	}

	.tp-rssd__title {
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-md);
		line-height: 1.35;
		overflow-wrap: anywhere;
	}

	/* The byline's parts are separate elements rather than one joined string
	   (CLAUDE.md rule 8), and the separator is drawn here. */
	.tp-rssd__byline {
		display: flex;
		flex-wrap: wrap;
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-rssd__byline > * + *::before {
		content: '·';
		margin: 0 0.375rem;
	}

	/* doc 08 §4: "Open original" is primary. */
	.tp-rssd__open {
		border-radius: var(--radius-ctl);
		background: var(--color-beacon);
		color: var(--color-ink-950);
		font-size: var(--text-xs);
		font-weight: 600;
		padding: 0.4rem 0.75rem;
		text-decoration: none;
	}

	.tp-rssd__back {
		display: none;
		border: 0;
		background: transparent;
		color: var(--color-beacon);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0;
	}

	.tp-rssd__note {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-xs);
	}

	/* Stacked (doc 08 §4): one column, the list and the reader taking turns, the
	   feed manager folded until asked for. */
	@container (max-width: 760px) {
		.tp-rssd__panes {
			grid-template-columns: minmax(0, 1fr);
			grid-template-rows: auto minmax(0, 1fr);
			gap: 0.75rem;
		}

		.tp-rssd__fold {
			display: inline;
			border: 0;
			background: transparent;
			color: var(--color-beacon);
			cursor: pointer;
			font: inherit;
			font-size: var(--text-2xs);
			padding: 0;
		}

		.tp-rssd__feeds {
			overflow: visible;
		}

		.tp-rssd__feeds[data-open='false'] .tp-rssd__feeds-body {
			display: none;
		}

		.tp-rssd__panes[data-reading='false'] .tp-rssd__reader {
			display: none;
		}

		.tp-rssd__panes[data-reading='true'] .tp-rssd__feeds,
		.tp-rssd__panes[data-reading='true'] .tp-rssd__list {
			display: none;
		}

		.tp-rssd__panes[data-reading='true'] {
			grid-template-rows: minmax(0, 1fr);
		}

		.tp-rssd__back {
			display: inline;
		}
	}
</style>
