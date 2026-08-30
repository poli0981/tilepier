<script lang="ts">
	import { dateKeyOf } from '$lib/core/date-key';
	import { logEntry } from '$lib/core/log-buffer';
	import { useRefresh } from '$lib/core/refresh.svelte';
	import type { TpWidgetProps } from '$lib/core/types';
	import { lunarOf } from '$lib/lunar/amlich';
	import { fmtLunarShort } from '$lib/lunar/format';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import {
		attributionOf,
		bilingualPool,
		loadCatalogue,
		pickOfDay,
		quoteText,
		readSettings,
		toggleFavourite,
		type TpQuote
	} from './service';

	/**
	 * doc 08 §3 — the tile: one line a day, the same one for every reader,
	 * computed from the date rather than fetched.
	 *
	 * **States (doc 06 §3).** `quote` sat in the cached-data row of that table
	 * and in doc 17 §3's, which contradicted doc 08 §3's own "bundled dataset,
	 * no network". Both were corrected on 2026-08-28 and it is pure-client, so
	 * `stale`, `stale-error` and `offline` are N/A.
	 *
	 * The other four are all genuinely reachable here, which is unusual for a
	 * tier-1 widget: `loading` because the catalogue is a dynamic import and is
	 * not there on the first frame, `ready`, `error` if that import fails, and
	 * `empty` — in the detail's browse, where a filter can match nothing.
	 */
	let { settings: tileSettings, size, onUpdateSettings }: TpWidgetProps = $props();

	const prefs = $derived(readSettings(tileSettings));

	let today = $state(dateKeyOf(Date.now()));
	let pool = $state<TpQuote[] | null>(null);
	let failed = $state(false);
	let copied = $state(false);
	let copyTimer: ReturnType<typeof setTimeout> | null = null;

	// doc 06 §7: `midnight`. Without it a deck left open overnight would still
	// be showing yesterday's line, which is the one thing this widget must not
	// do (doc 04 §3, "Who registers").
	useRefresh(
		'quote',
		{ kind: 'midnight' },
		() => {
			today = dateKeyOf(Date.now());
		},
		{ label: 'quote:midnight' }
	);

	/**
	 * doc 13 §3's tier S — "single hero value, no header text (icon only)" —
	 * keyed off the row count rather than off `size.tier`, because the tier is
	 * `w <= 2 && h <= 1` and only the height half of that matters here. A 3x1
	 * tile is tier M and has exactly the same ~34 pixels to work with as a 2x1
	 * one; keying off the tier would have left every one-row tile wider than two
	 * columns rendering the tall layout into a box that cannot hold it.
	 *
	 * The hero value is the line itself, on one ellipsised row. The citation and
	 * the two actions go, which is the whole point: the footer is 21 of those
	 * pixels and it was the footer that pushed the line down to a 7-pixel slot
	 * and cut it through the middle of the glyphs. Nothing is lost that the
	 * detail does not have — it carries the attribution, the copy and the keep.
	 * doc 08 §3 carries the deviation, because the lunar footer goes with them.
	 */
	const short = $derived(size.h <= 1);

	const quote = $derived(pool === null ? null : pickOfDay(pool, today));
	const text = $derived(quote === null ? '' : quoteText(quote, settings.locale));
	const attribution = $derived(quote === null ? '' : attributionOf(quote));
	const isKept = $derived(quote !== null && prefs.favourites.includes(quote.id));

	/** doc 08 §3's lunar footer — the QuoteAtlas tie-in, vi only, and the same
	 *  reading of doc 07 §6 the clock tile takes: the lunar date *of the date
	 *  shown*, converted at UTC+7. */
	const lunar = $derived.by(() => {
		if (settings.locale !== 'vi') return '';
		const value = lunarOf(new Date(`${today}T00:00:00`));
		return value === null ? '' : fmtLunarShort(value, 'vi');
	});

	$effect(() => {
		// Loads the bundled catalogue once. Local, not networked — `qr.ts` and
		// this are the two dynamic imports on the deck that are about bytes
		// rather than about the network (doc 20 §7).
		let cancelled = false;

		loadCatalogue()
			.then((catalogue) => {
				if (cancelled) return;
				pool = bilingualPool(catalogue);
				failed = false;
			})
			.catch((error: unknown) => {
				if (cancelled) return;
				logEntry('warn', 'could not load the quote catalogue', { src: 'widget', error });
				pool = [];
				failed = true;
			});

		return () => {
			cancelled = true;
		};
	});

	$effect(() => {
		return () => {
			if (copyTimer !== null) clearTimeout(copyTimer);
		};
	});

	async function copy(): Promise<void> {
		if (text === '') return;
		await navigator.clipboard.writeText(attribution === '' ? text : `${text}\n— ${attribution}`);
		copied = true;
		if (copyTimer !== null) clearTimeout(copyTimer);
		copyTimer = setTimeout(() => (copied = false), 1400);
	}

	function keep(): void {
		if (quote === null) return;
		onUpdateSettings?.({ favourites: toggleFavourite(prefs.favourites, quote.id) });
	}
</script>

<div class="tp-quote" data-tier={size.tier} class:tp-quote--short={short}>
	{#if failed}
		<p class="tp-quote__error" role="alert">{m['widget.quote.failed']()}</p>
	{:else if pool === null}
		<!-- doc 13 §7: a skeleton, never a spinner. The catalogue is 23 KB gz
		     behind a dynamic import, so this is a real frame rather than a
		     theoretical one. One bar at a row tall: three of them are 30 pixels
		     of the 34 there are, which is a loading state that overflows into the
		     ready one it is standing in for. -->
		<div class="tp-quote__skeleton" aria-label={m['widget.quote.loading']()}>
			<span></span>
			{#if !short}
				<span></span><span></span>
			{/if}
		</div>
	{:else if quote !== null}
		<blockquote class="tp-quote__text" data-testid="quote-text">{text}</blockquote>
		{#if !short}
			<footer>
				{#if attribution !== ''}
					<cite class="tp-quote__cite" data-testid="quote-cite">{attribution}</cite>
				{/if}
				{#if lunar !== ''}
					<span class="tp-quote__lunar tp-num" data-testid="quote-lunar">{lunar}</span>
				{/if}
				<button
					type="button"
					class="tp-quote__action"
					aria-pressed={isKept}
					aria-label={isKept ? m['widget.quote.unfavourite']() : m['widget.quote.favourite']()}
					data-testid="quote-keep"
					onclick={keep}
				>
					<TpIcon name={isKept ? 'check' : 'plus'} size={13} />
				</button>
				<button
					type="button"
					class="tp-quote__action"
					aria-label={copied ? m['widget.quote.copied']() : m['widget.quote.copy']()}
					data-testid="quote-copy"
					onclick={() => void copy()}
				>
					<TpIcon name={copied ? 'check' : 'note'} size={13} />
				</button>
			</footer>
		{/if}
	{/if}
</div>

<style>
	.tp-quote {
		display: flex;
		height: 100%;
		flex-direction: column;
		justify-content: center;
		gap: 0.375rem;
		overflow: hidden;
	}

	.tp-quote__text {
		margin: 0;
		overflow: hidden;
		color: var(--color-fg);
		font-size: var(--text-xs);
		line-height: 1.5;
	}

	.tp-quote[data-tier='L'] .tp-quote__text {
		font-size: var(--text-sm);
	}

	/* The one-row tile. `[data-tier='S']` used to carry the smaller type here and
	   is gone rather than kept alongside: tier S is `w <= 2 && h <= 1`, so every
	   S tile is a short one and the rule was the narrow half of this one. */
	.tp-quote--short .tp-quote__text {
		font-size: var(--text-2xs);
		/* `flex: 0 0 auto` so the line keeps its own height instead of being
		   compressed to whatever is left — being clipped top and bottom is the
		   bug. If a row is ever shorter than a line, the container's
		   `overflow: hidden` clips the descenders and the sentence still reads,
		   which is the failure mode worth having. */
		flex: 0 0 auto;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	footer {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-quote__cite {
		flex: 1 1 auto;
		overflow: hidden;
		font-style: normal;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-quote__lunar {
		flex: 0 0 auto;
		color: var(--color-fg-dim);
	}

	.tp-quote__action {
		display: flex;
		flex: 0 0 auto;
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		line-height: 1;
		padding: 0.25rem;
	}

	.tp-quote__action:hover,
	.tp-quote__action[aria-pressed='true'] {
		color: var(--color-beacon);
	}

	.tp-quote__error {
		margin: 0;
		color: var(--color-warn);
		font-size: var(--text-2xs);
	}

	/* doc 12 §5: the skeleton shimmer is the tide gauge rising, and it holds
	   still under reduced motion (doc 12 §7). */
	.tp-quote__skeleton {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.tp-quote__skeleton span {
		height: 0.6rem;
		border-radius: 3px;
		background: var(--color-ink-850);
	}

	.tp-quote__skeleton span:nth-child(1) {
		width: 92%;
	}

	.tp-quote__skeleton span:nth-child(2) {
		width: 78%;
	}

	.tp-quote__skeleton span:nth-child(3) {
		width: 40%;
	}

	@media (prefers-reduced-motion: no-preference) {
		.tp-quote__skeleton span {
			animation: tp-quote-tide 1.6s ease-in-out infinite;
		}

		.tp-quote__skeleton span:nth-child(2) {
			animation-delay: 0.12s;
		}

		.tp-quote__skeleton span:nth-child(3) {
			animation-delay: 0.24s;
		}
	}

	@keyframes tp-quote-tide {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}
</style>
