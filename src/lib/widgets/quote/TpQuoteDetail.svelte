<script lang="ts">
	import { copyText } from '$lib/core/clipboard';
	import { dateKeyOf } from '$lib/core/date-key';
	import { logEntry } from '$lib/core/log-buffer';
	import { lunarOf } from '$lib/lunar/amlich';
	import { fmtLunarShort } from '$lib/lunar/format';
	import type { TpDetailProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		attributionOf,
		authorsOf,
		bilingualPool,
		filterQuotes,
		loadCatalogue,
		pickOfDay,
		quoteText,
		readSettings,
		tagsOf,
		toggleFavourite,
		type TpQuoteCatalogue
	} from './service';

	/**
	 * doc 08 §3 — the detail: browse by theme and author, search, and the
	 * favourites the tile's heart writes.
	 *
	 * **Share-as-image is deliberately not here.** That section calls it a
	 * stretch and doc 23's slip policy lists "quote browse-detail (keep tile)"
	 * among the things to sacrifice, so the stretch on top of a cut-line item is
	 * the first thing to go. The canvas work it would need is now in
	 * `widgets/toolbox/qr.ts` if it is ever wanted.
	 */
	let { settings: tileSettings, onUpdateSettings }: TpDetailProps = $props();

	const prefs = $derived(readSettings(tileSettings));

	let catalogue = $state<TpQuoteCatalogue | null>(null);
	let failed = $state(false);

	let query = $state('');
	let tag = $state('');
	let author = $state('');
	let favouritesOnly = $state(false);

	const today = dateKeyOf(Date.now());

	const todayQuote = $derived(
		catalogue === null ? null : pickOfDay(bilingualPool(catalogue), today)
	);

	/**
	 * What the one-row tile leaves out, carried here (doc 08 §3): the tile drops
	 * the lunar footer, the keep and the copy at h = 1 on the understanding that
	 * "the detail keeps all four". Until Week 8 it kept two — the attribution, and
	 * a keep only by finding the quote again in the list below.
	 */
	const todayText = $derived(todayQuote === null ? '' : quoteText(todayQuote, settings.locale));
	const todayAttribution = $derived(todayQuote === null ? '' : attributionOf(todayQuote));
	const todayKept = $derived(todayQuote !== null && prefs.favourites.includes(todayQuote.id));

	/** The tile's lunar footer, in the tile's words: vi only, the lunar date of
	 *  the date shown. */
	const lunar = $derived.by(() => {
		if (settings.locale !== 'vi') return '';
		const value = lunarOf(new Date(`${today}T00:00:00`));
		return value === null ? '' : fmtLunarShort(value, 'vi');
	});

	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		return () => {
			if (copyTimer !== null) clearTimeout(copyTimer);
		};
	});

	/** The tile's copy: the line, then the attribution on a line of its own. */
	async function copyToday(): Promise<void> {
		if (todayText === '') return;
		const text = todayAttribution === '' ? todayText : `${todayText}\n— ${todayAttribution}`;
		if (!(await copyText(text))) return;
		copied = true;
		if (copyTimer !== null) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 1400);
	}

	const tags = $derived(catalogue === null ? [] : tagsOf(catalogue));
	const authors = $derived(catalogue === null ? [] : authorsOf(catalogue));

	const results = $derived(
		catalogue === null
			? []
			: filterQuotes(
					catalogue,
					{
						query,
						...(tag === '' ? {} : { tag }),
						...(author === '' ? {} : { author }),
						favouritesOnly
					},
					prefs.favourites
				)
	);

	$effect(() => {
		let cancelled = false;

		loadCatalogue()
			.then((loaded) => {
				if (cancelled) return;
				catalogue = loaded;
				failed = false;
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				logEntry('warn', 'could not load the quote catalogue', { src: 'widget', error });
				failed = true;
			});

		return () => {
			cancelled = true;
		};
	});

	function keep(id: string): void {
		onUpdateSettings?.({ favourites: toggleFavourite(prefs.favourites, id) });
	}

	function keepToday(): void {
		if (todayQuote !== null) keep(todayQuote.id);
	}
</script>

<div class="tp-quoted">
	{#if failed}
		<p class="tp-quoted__error" role="alert">{m['widget.quote.failed']()}</p>
	{:else if catalogue === null}
		<p class="tp-quoted__hint">{m['widget.quote.loading']()}</p>
	{:else}
		{#if todayQuote !== null}
			<section class="tp-quoted__today" aria-label={m['widget.quote.today']()}>
				<h3>{m['widget.quote.today']()}</h3>
				<blockquote data-testid="today-text">{todayText}</blockquote>
				<div class="tp-quoted__foot">
					{#if todayAttribution !== ''}
						<cite>{todayAttribution}</cite>
					{/if}
					{#if lunar !== ''}
						<span class="tp-quoted__lunar tp-num" data-testid="today-lunar">{lunar}</span>
					{/if}
					<button
						type="button"
						aria-pressed={todayKept}
						aria-label={todayKept ? m['widget.quote.unfavourite']() : m['widget.quote.favourite']()}
						data-testid="today-keep"
						onclick={keepToday}
					>
						<TpIcon name={todayKept ? 'check' : 'plus'} size={14} />
					</button>
					<button
						type="button"
						aria-label={copied ? m['widget.quote.copied']() : m['widget.quote.copy']()}
						data-testid="today-copy"
						onclick={() => void copyToday()}
					>
						<TpIcon name={copied ? 'check' : 'note'} size={14} />
					</button>
				</div>
			</section>
		{/if}

		<section aria-label={m['widget.quote.browse']()}>
			<h3>{m['widget.quote.browse']()}</h3>

			<div class="tp-quoted__filters">
				<input
					type="search"
					bind:value={query}
					placeholder={m['widget.quote.search']()}
					aria-label={m['widget.quote.search']()}
					data-testid="quote-search"
				/>
				<label>
					<span>{m['widget.quote.tag']()}</span>
					<select bind:value={tag} data-testid="quote-tag">
						<option value="">{m['widget.quote.any_tag']()}</option>
						{#each tags as value (value)}
							<option {value}>{value}</option>
						{/each}
					</select>
				</label>
				<label>
					<span>{m['widget.quote.author']()}</span>
					<select bind:value={author} data-testid="quote-author">
						<option value="">{m['widget.quote.any_author']()}</option>
						{#each authors as value (value)}
							<option {value}>{value}</option>
						{/each}
					</select>
				</label>
				<label class="tp-quoted__check">
					<input type="checkbox" bind:checked={favouritesOnly} data-testid="quote-kept-only" />
					{m['widget.quote.favourites_only']()}
				</label>
			</div>

			<p class="tp-quoted__count tp-num" data-testid="quote-count">
				{m['widget.quote.results']({
					count: results.length,
					total: catalogue.quotes.length
				})}
			</p>

			{#if results.length === 0}
				<!-- doc 06 §3's `empty`, in its two shapes: a filter that matched
				     nothing, and a favourites list with nothing in it yet. They lead
				     to different actions, so they are different sentences. -->
				<p class="tp-quoted__hint" data-testid="quote-empty">
					{favouritesOnly && query === '' && tag === '' && author === ''
						? m['widget.quote.no_favourites']()
						: m['widget.quote.no_matches']()}
				</p>
			{:else}
				<ul class="tp-quoted__list">
					{#each results.slice(0, 60) as entry (entry.id)}
						<li>
							<div class="tp-quoted__entry">
								<blockquote>{quoteText(entry, settings.locale)}</blockquote>
								{#if attributionOf(entry) !== ''}
									<cite>{attributionOf(entry)}</cite>
								{/if}
							</div>
							<button
								type="button"
								aria-pressed={prefs.favourites.includes(entry.id)}
								aria-label={prefs.favourites.includes(entry.id)
									? m['widget.quote.unfavourite']()
									: m['widget.quote.favourite']()}
								onclick={() => keep(entry.id)}
							>
								<TpIcon name={prefs.favourites.includes(entry.id) ? 'check' : 'plus'} size={14} />
							</button>
						</li>
					{/each}
				</ul>
				{#if results.length > 60}
					<!-- Capped rather than windowed. doc 20 §7 puts the windowing
					     helper at 200 rows and this list is a browse, not a library:
					     narrowing the filter is the better answer, and the count line
					     above says how much is not shown. -->
					<p class="tp-quoted__hint">
						{m['widget.quote.results']({ count: 60, total: results.length })}
					</p>
				{/if}
			{/if}
		</section>

		<p class="tp-quoted__note">{m['widget.quote.source_note']()}</p>
	{/if}
</div>

<style>
	.tp-quoted {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 0.5rem 0;
	}

	h3 {
		margin: 0 0 0.375rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
		font-weight: 600;
	}

	.tp-quoted__today blockquote {
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-md);
		line-height: 1.5;
	}

	cite {
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		font-style: normal;
	}

	.tp-quoted__foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}

	.tp-quoted__foot cite {
		flex: 1 1 auto;
	}

	.tp-quoted__lunar {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-quoted__filters {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: 0.75rem;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-quoted__check {
		flex-direction: row;
		align-items: center;
		gap: 0.375rem;
		min-height: 2.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	input[type='search'],
	select {
		min-height: 2.5rem;
		padding: 0 0.5rem;
		border: 1px solid var(--color-field);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
	}

	input[type='search'] {
		flex: 1 1 12rem;
	}

	select {
		max-width: 12rem;
	}

	.tp-quoted__count {
		margin: 0.5rem 0 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-quoted__list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		margin: 0.5rem 0 0;
		padding: 0;
		list-style: none;
	}

	.tp-quoted__list li {
		display: flex;
		align-items: flex-start;
		gap: 0.5rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--color-ink-700);
	}

	.tp-quoted__entry {
		flex: 1 1 auto;
		min-width: 0;
	}

	.tp-quoted__entry blockquote {
		margin: 0 0 0.125rem;
		color: var(--color-fg);
		font-size: var(--text-xs);
		line-height: 1.5;
	}

	button {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		justify-content: center;
		min-width: 2.5rem;
		min-height: 2.5rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
	}

	button[aria-pressed='true'] {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	.tp-quoted__hint,
	.tp-quoted__note {
		margin: 0.5rem 0 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-quoted__error {
		margin: 0;
		color: var(--color-warn);
		font-size: var(--text-xs);
	}
</style>
