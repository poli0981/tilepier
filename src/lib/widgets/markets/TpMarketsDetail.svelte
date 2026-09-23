<script lang="ts">
	import { untrack } from 'svelte';
	import { CRYPTO_RANGE_DEFAULT, CRYPTO_RANGES, STOCK_RANGES } from '$lib/api-types';
	import TpChart from '$lib/charts/TpChart.svelte';
	import type { TpDb } from '$lib/core/storage/db';
	import type { TpSwrHandle } from '$lib/core/swr.svelte';
	import type { TpDetailProps } from '$lib/core/types';
	import { fmtPercentChange, fmtPrice, fmtRelative } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { candleSummary, candlestickOption } from './chart';
	import {
		addToWatchlist,
		atClose,
		cryptoSide,
		cryptoSource,
		entryId,
		klinesSource,
		labelOf,
		MARKET_RANGES,
		moveInWatchlist,
		priceDigits,
		readSettings,
		removeFromWatchlist,
		rowsFor,
		searchSource,
		searchTerm,
		stockQuotesKey,
		stockRangeFor,
		stockSeriesSource,
		stockSide,
		stockSource,
		suggestions,
		symbolsOf,
		tickerKey,
		windowOf,
		type TpKlinesReading,
		type TpMarketRange,
		type TpSearchReading,
		type TpStockReading,
		type TpStockSeriesReading,
		type TpTickerReading,
		type TpWatchlistRefusal
	} from './service';
	import { MAX_WATCHLIST, type TpMarketKind, type TpWatchEntry } from './types';

	/**
	 * doc 09 §1's detail: a symbol header, candles with a volume band, the range
	 * presets, and the watchlist manager with search-add.
	 *
	 * **No `useRefresh` here**, for the reason `TpCurrencyDetail.svelte` gives:
	 * a panel is open for seconds at a time, and registering a cadence would put
	 * a row in the diagnostics table for a task that will not come due. `swr`'s
	 * own hydrate-then-revalidate-if-stale on subscribe is the whole refresh
	 * story a panel needs — and here it is a *better* one than a cadence, because
	 * switching range re-subscribes and that is exactly when new candles matter.
	 *
	 * **This is the only place a stock series is asked for** (doc 11 §5: "series
	 * fetched only when a detail view opens (not for tiles)"), which is what
	 * keeps Twelve Data's 800 credits a day an honest budget.
	 *
	 * **`MAX` is absent from the range picker**, which is Week 5's one approved
	 * depth cut (doc 23 §Week 5). 1Y tells an honest story; `MAX` only reaches
	 * for Twelve Data's EOD depth, which is the most expensive thing in the
	 * quota model and buys a longer axis rather than a different answer.
	 */
	interface Props extends TpDetailProps {
		/** Test seam, as on the tile: a throwaway Dexie rather than the reader's. */
		db?: TpDb | undefined;
	}

	let { settings: tileSettings, onUpdateSettings, db = undefined }: Props = $props();

	const prefs = $derived(readSettings(tileSettings));
	const cryptoSymbols = $derived(symbolsOf(prefs.watchlist, 'crypto'));
	const stockSymbols = $derived(symbolsOf(prefs.watchlist, 'stock'));

	/**
	 * Which row the panel is showing, as an `entryId` — the symbol alone is not
	 * unique on a watchlist that holds both kinds.
	 *
	 * Local rather than persisted: doc 05 §2 keeps tile settings for what a
	 * reader arranged, and "the row I clicked last" is not that — it would make
	 * the tile's stored bag change every time somebody looked at a chart.
	 */
	let picked = $state<string | null>(null);
	const entry = $derived(
		prefs.watchlist.find((row) => entryId(row) === picked) ?? prefs.watchlist[0] ?? null
	);
	const label = $derived(entry === null ? '' : labelOf(entry));
	const isStock = $derived(entry?.kind === 'stock');

	let range = $state<TpMarketRange>(CRYPTO_RANGE_DEFAULT);

	/* ─────────────────────────────────────────────────────────── the quotes */

	const cryptoKey = $derived(cryptoSymbols.length === 0 ? '' : tickerKey(cryptoSymbols));
	const stockKey = $derived(stockSymbols.length === 0 ? '' : stockQuotesKey(stockSymbols));

	let ticker = $state.raw<TpSwrHandle<TpTickerReading> | null>(null);
	let stockQuotes = $state.raw<TpSwrHandle<TpStockReading> | null>(null);

	// The tile's own subscriptions, under the same keys, so `swr` hands both
	// callers one entry and one request. `untrack` for the reason doc 06 §5
	// rule 7 gives: `swr()` reads its dedupe map and then writes to it, and that
	// map is a `SvelteMap`.
	$effect(() => {
		const key = cryptoKey;
		const source = untrack(() => (key === '' ? null : cryptoSource(cryptoSymbols, db)));
		ticker = source;
		return () => {
			source?.release();
			ticker = null;
		};
	});

	$effect(() => {
		const key = stockKey;
		const source = untrack(() => (key === '' ? null : stockSource(stockSymbols, db)));
		stockQuotes = source;
		return () => {
			source?.release();
			stockQuotes = null;
		};
	});

	const row = $derived(
		entry === null
			? null
			: (rowsFor([entry], {
					crypto: ticker === null ? null : cryptoSide(ticker),
					stock: stockQuotes === null ? null : stockSide(stockQuotes)
				})[0] ?? null)
	);
	const quote = $derived(row?.state.kind === 'quoted' ? row.state.quote : null);

	let now = $state(Date.now());
	$effect(() => {
		const id = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(id);
	});

	const closed = $derived(entry !== null && quote !== null && atClose(entry.kind, quote, now));

	/* ────────────────────────────────────────────────────────── the candles */

	/**
	 * Stock symbols whose 1D the Worker refused for quota while this panel has
	 * been open — doc 09 §1's ladder, where 1D collapses to the daily week
	 * between the intraday stop (720) and the daily one (780).
	 *
	 * Per symbol and per panel: the refusal is about today's budget, which the
	 * next opening asks about again for the price of one request that spends
	 * nothing, and a symbol that has intraday candles cached is not refused at
	 * all — the Worker serves those stale instead.
	 */
	let intradayRefused = $state.raw<ReadonlySet<string>>(new Set());

	/** The range actually drawn, which is the picked one unless the ladder says
	 *  otherwise. The picker keeps showing what the reader chose. */
	const drawn = $derived(
		entry?.kind === 'stock' ? stockRangeFor(range, intradayRefused.has(entry.symbol)) : range
	);
	const degraded = $derived(drawn !== range);

	/** A string, so the subscription below re-runs when the question changes and
	 *  not when a reorder hands `entry` over as a new object. */
	const seriesId = $derived(entry === null ? '' : `${entryId(entry)}|${drawn}`);

	let series = $state.raw<TpSwrHandle<TpKlinesReading> | TpSwrHandle<TpStockSeriesReading> | null>(
		null
	);

	$effect(() => {
		const id = seriesId;
		if (id === '') {
			series = null;
			return;
		}

		const source = untrack(() => {
			const current = entry as TpWatchEntry;
			return current.kind === 'stock'
				? stockSeriesSource(current.symbol, drawn, db)
				: klinesSource(current.symbol, drawn, db);
		});
		series = source;
		return () => {
			source.release();
			series = null;
		};
	});

	// The ladder's trigger. Only a refusal with nothing to show counts: stale
	// intraday candles are still intraday candles, and the Worker only refuses
	// when it has none (doc 11 §5).
	$effect(() => {
		const current = series;
		const symbol = entry?.kind === 'stock' ? entry.symbol : null;
		if (current === null || symbol === null || drawn !== '1D') return;
		if (current.error !== 'QUOTA_EXHAUSTED' || current.data !== undefined) return;

		untrack(() => {
			intradayRefused = new Set([...intradayRefused, symbol]);
		});
	});

	const limit = $derived(
		entry?.kind === 'stock' ? STOCK_RANGES[drawn].limit : CRYPTO_RANGES[drawn].limit
	);
	const candles = $derived(windowOf(series?.data?.payload.candles ?? [], limit));
	const candleStatus = $derived(series?.status ?? 'loading');
	const summary = $derived(candleSummary(candles));

	const digits = $derived(priceDigits(quote?.price ?? candles.at(-1)?.[4] ?? 1));

	function priceText(value: number): string {
		return fmtPrice(value, settings.locale, digits);
	}

	const RANGE_LABELS: Record<TpMarketRange, () => string> = {
		'1D': () => m['widget.markets.range_1d'](),
		'1W': () => m['widget.markets.range_1w'](),
		'1M': () => m['widget.markets.range_1m'](),
		'1Y': () => m['widget.markets.range_1y']()
	};

	const option = $derived(
		candlestickOption(candles, {
			formatPrice: priceText,
			volumeLabel: m['widget.markets.volume']()
		})
	);

	/** doc 13 §8: every ECharts view is paired with an accessible summary line,
	 *  and it carries the same facts the picture does — including which range
	 *  it is, which is the drawn one when the ladder stepped in. */
	const summaryLine = $derived(
		summary === null || entry === null
			? m['widget.markets.chart_empty']()
			: m['widget.markets.chart_summary']({
					symbol: label,
					range: RANGE_LABELS[drawn](),
					change: fmtPercentChange(summary.change, settings.locale),
					open: priceText(summary.open),
					close: priceText(summary.close),
					low: priceText(summary.low),
					high: priceText(summary.high)
				})
	);

	/* ────────────────────────────────────── the watchlist manager (doc 09 §1) */

	let addKind = $state<TpMarketKind>('crypto');
	let draft = $state('');
	let refused = $state<TpWatchlistRefusal | null>(null);
	/** What the refusal was about. Not `draft`: a search result is added by its
	 *  symbol while the box still holds the company name that found it. */
	let refusedSymbol = $state('');

	const offered = $derived(suggestions(prefs.watchlist));

	function persist(watchlist: readonly TpWatchEntry[]): void {
		onUpdateSettings?.({ watchlist: [...watchlist] });
	}

	function addSymbol(kind: TpMarketKind, raw: string): void {
		const edit = addToWatchlist(prefs.watchlist, kind, raw);
		refused = edit.refused;
		refusedSymbol = raw.trim().toUpperCase();
		if (edit.refused !== null) return;

		draft = '';
		persist(edit.watchlist);
	}

	function drop(target: TpWatchEntry): void {
		refused = null;
		persist(removeFromWatchlist(prefs.watchlist, target.kind, target.symbol));
	}

	function move(index: number, delta: number): void {
		refused = null;
		persist(moveInWatchlist(prefs.watchlist, index, delta));
	}

	const refusalText = $derived.by(() => {
		if (refused === null) return '';
		if (refused === 'invalid') return m['widget.markets.refused_invalid']();
		if (refused === 'duplicate') {
			return m['widget.markets.refused_duplicate']({ symbol: refusedSymbol });
		}
		return m['widget.markets.refused_full']({ max: String(MAX_WATCHLIST) });
	});

	/* ─────────────────────────────────── search-add, for stocks (doc 09 §1) */

	/** Long enough that a word typed at speed asks once, short enough that the
	 *  answer arrives while the reader is still looking at the box. */
	const SEARCH_DEBOUNCE_MS = 300;
	/** What fits under the box without pushing the watchlist off the panel. */
	const SEARCH_SHOWN = 6;

	/** The settled query, or `null` for nothing worth asking — which is every
	 *  keystroke of a coin, whose list is the bundled one. */
	let term = $state<string | null>(null);

	$effect(() => {
		const text = draft;
		const kind = addKind;
		const id = setTimeout(() => {
			term = kind === 'stock' ? searchTerm(text) : null;
		}, SEARCH_DEBOUNCE_MS);
		return () => clearTimeout(id);
	});

	let search = $state.raw<TpSwrHandle<TpSearchReading> | null>(null);

	// A subscription, not a fetch: the effect hands the question to `swr`, which
	// owns the request, the day-long cache and the abort when the reader types
	// on (CLAUDE.md rule 6).
	$effect(() => {
		const current = term;
		if (current === null) {
			search = null;
			return;
		}
		const source = untrack(() => searchSource(current, db));
		search = source;
		return () => {
			source.release();
			search = null;
		};
	});

	const results = $derived((search?.data?.payload.results ?? []).slice(0, SEARCH_SHOWN));
	const searchFailed = $derived(
		search !== null &&
			search.data === undefined &&
			search.status !== 'loading' &&
			search.status !== 'idle'
	);

	function held(symbol: string): boolean {
		return prefs.watchlist.some((row) => row.kind === 'stock' && row.symbol === symbol);
	}

	const KIND_LABELS: Record<TpMarketKind, () => string> = {
		crypto: () => m['widget.markets.kind_crypto'](),
		stock: () => m['widget.markets.kind_stock']()
	};

	/* ─────────────────────────────────────────────────────────── the credits */

	/**
	 * doc 16 §5's credit lines, from the payloads that were actually drawn — a
	 * stock names Finnhub for the price and Twelve Data for the candles, a coin
	 * names Binance.US once.
	 */
	const credits = $derived.by(() => {
		const quoteCredit =
			entry?.kind === 'stock'
				? stockQuotes?.data?.payload.attribution
				: ticker?.data?.payload.attribution;
		const lines = [quoteCredit, series?.data?.payload.attribution].filter(
			(line): line is string => line !== undefined && line !== ''
		);
		return lines.filter((line, index) => lines.indexOf(line) === index);
	});
</script>

<div class="tp-mkd">
	{#if entry === null}
		<p class="tp-mkd__empty">{m['widget.markets.nothing_selected']()}</p>
	{:else}
		<header class="tp-mkd__head">
			<div class="tp-mkd__ident">
				<h3 class="tp-mkd__symbol">{label}</h3>
				{#if prefs.watchlist.length > 1}
					<!-- `for`, not a wrapping label: a label around a select lends it the
					     chosen option's text too, and "symbol AAPL" read before "AAPL" is
					     the answer announced twice. -->
					<div class="tp-mkd__pick">
						<label class="tp-mkd__pick-label" for="tp-mkd-pick">
							{m['widget.markets.symbol_label']()}
						</label>
						<select
							id="tp-mkd-pick"
							value={entryId(entry)}
							onchange={(event) => (picked = event.currentTarget.value)}
						>
							{#each prefs.watchlist as option (entryId(option))}
								<option value={entryId(option)}>{labelOf(option)}</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>

			{#if quote !== null}
				<div class="tp-mkd__figures">
					<span class="tp-mkd__price tp-num">{priceText(quote.price)}</span>
					{#if quote.change !== null}
						<span
							class="tp-mkd__change tp-num"
							class:tp-mkd__change--up={quote.change > 0}
							class:tp-mkd__change--down={quote.change < 0}
						>
							{fmtPercentChange(quote.change, settings.locale)}
						</span>
					{/if}
					{#if quote.low !== null && quote.high !== null}
						{@const band = { low: priceText(quote.low), high: priceText(quote.high) }}
						<span class="tp-mkd__band tp-num">
							{isStock ? m['widget.markets.day_band'](band) : m['widget.markets.day_range'](band)}
						</span>
					{/if}
					{#if closed}
						<span class="tp-mkd__band">
							{m['widget.markets.at_close_hint']({
								age: fmtRelative(quote.at, settings.locale, now)
							})}
						</span>
					{/if}
				</div>
			{/if}
		</header>

		<fieldset class="tp-mkd__ranges">
			<legend class="tp-mkd__ranges-legend">{m['widget.markets.range_label']()}</legend>
			{#each MARKET_RANGES as key (key)}
				<button
					type="button"
					class="tp-mkd__range"
					class:tp-mkd__range--on={range === key}
					aria-pressed={range === key}
					onclick={() => (range = key)}
				>
					{RANGE_LABELS[key]()}
				</button>
			{/each}
		</fieldset>

		{#if degraded}
			<p class="tp-mkd__note" role="status">{m['widget.markets.intraday_paused']()}</p>
		{/if}

		{#if candles.length > 0}
			<TpChart
				{option}
				summary={summaryLine}
				loadingLabel={m['widget.markets.chart_loading']()}
				failedLabel={m['widget.markets.chart_failed']()}
				height={280}
			/>
		{:else if candleStatus === 'offline'}
			<p class="tp-mkd__note">{m['widget.markets.detail_offline']()}</p>
		{:else if isStock && series?.error === 'QUOTA_EXHAUSTED'}
			<!-- The ladder's last rung: nothing stale, and nothing left to spend
			     today. The price above still stands. -->
			<p class="tp-mkd__note">{m['widget.markets.quota_note']()}</p>
		{:else if candleStatus === 'error' || candleStatus === 'stale-error'}
			<p class="tp-mkd__note">{m['widget.markets.detail_error']()}</p>
		{:else if candleStatus === 'rate-limited'}
			<p class="tp-mkd__note">{m['widget.markets.rate_limited']()}</p>
		{:else if candleStatus === 'loading' || candleStatus === 'idle'}
			<p class="tp-mkd__note">{m['widget.markets.chart_loading']()}</p>
		{:else if isStock}
			<!-- doc 09 §1: a symbol Finnhub quotes and Twelve Data does not cover
			     is quote-only, which the Worker answers as an empty series. -->
			<p class="tp-mkd__note">{m['widget.markets.quote_only']({ symbol: label })}</p>
		{:else}
			<p class="tp-mkd__note">{m['widget.markets.chart_empty']()}</p>
		{/if}

		<section class="tp-mkd__manage">
			<h4 class="tp-mkd__manage-heading">{m['widget.markets.manage_heading']()}</h4>

			<ul class="tp-mkd__rows">
				{#each prefs.watchlist as row, index (entryId(row))}
					<li class="tp-mkd__row">
						<span class="tp-mkd__row-label">{labelOf(row)}</span>
						<span class="tp-mkd__row-kind">{KIND_LABELS[row.kind]()}</span>
						<button
							type="button"
							class="tp-mkd__row-btn tp-mkd__row-btn--up"
							aria-label={m['widget.markets.move_up']({ symbol: row.symbol })}
							disabled={index === 0}
							onclick={() => move(index, -1)}
						>
							<TpIcon name="chevron" size={16} />
						</button>
						<button
							type="button"
							class="tp-mkd__row-btn"
							aria-label={m['widget.markets.move_down']({ symbol: row.symbol })}
							disabled={index === prefs.watchlist.length - 1}
							onclick={() => move(index, 1)}
						>
							<TpIcon name="chevron" size={16} />
						</button>
						<button
							type="button"
							class="tp-mkd__row-btn"
							aria-label={m['widget.markets.remove_row']({ symbol: row.symbol })}
							onclick={() => drop(row)}
						>
							<TpIcon name="trash" size={16} />
						</button>
					</li>
				{/each}
			</ul>

			<div class="tp-mkd__add">
				<label class="tp-mkd__add-label" for="tp-mkd-kind">
					{m['widget.markets.kind_label']()}
				</label>
				<select id="tp-mkd-kind" class="tp-mkd__add-kind" bind:value={addKind}>
					<option value="crypto">{KIND_LABELS.crypto()}</option>
					<option value="stock">{KIND_LABELS.stock()}</option>
				</select>
				<label class="tp-mkd__add-label" for="tp-mkd-add">
					{addKind === 'stock'
						? m['widget.markets.add_label_stock']()
						: m['widget.markets.add_label']()}
				</label>
				<input
					id="tp-mkd-add"
					list={addKind === 'crypto' ? 'tp-mkd-suggestions' : undefined}
					class="tp-mkd__add-input"
					autocomplete="off"
					bind:value={draft}
					onkeydown={(event) => {
						if (event.key === 'Enter') addSymbol(addKind, draft);
					}}
				/>
				<datalist id="tp-mkd-suggestions">
					{#each offered as symbol (symbol)}
						<option value={symbol}></option>
					{/each}
				</datalist>
				<button type="button" class="tp-mkd__add-btn" onclick={() => addSymbol(addKind, draft)}>
					{m['widget.markets.add_row']()}
				</button>
			</div>

			{#if addKind === 'stock' && term !== null}
				{#if results.length > 0}
					<ul class="tp-mkd__results" aria-label={m['widget.markets.search_results']()}>
						{#each results as result (result.symbol)}
							{@const already = held(result.symbol)}
							<li>
								<button
									type="button"
									class="tp-mkd__result"
									disabled={already}
									aria-label={already
										? m['widget.markets.refused_duplicate']({ symbol: result.symbol })
										: m['widget.markets.search_add']({
												symbol: result.symbol,
												name: result.name
											})}
									onclick={() => addSymbol('stock', result.symbol)}
								>
									<span class="tp-mkd__result-symbol tp-num">{result.symbol}</span>
									<!-- Finnhub's description: a text node, never markup (rule 7). -->
									<span class="tp-mkd__result-name">{result.name}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if searchFailed}
					<p class="tp-mkd__hint">{m['widget.markets.search_failed']()}</p>
				{:else if search?.data !== undefined}
					<p class="tp-mkd__hint">{m['widget.markets.search_empty']({ query: term })}</p>
				{/if}
			{/if}

			{#if refusalText !== ''}
				<p class="tp-mkd__refusal" role="status">{refusalText}</p>
			{:else if addKind === 'crypto' && offered.length === 0}
				<p class="tp-mkd__hint">{m['widget.markets.all_added']()}</p>
			{/if}
		</section>

		<footer class="tp-mkd__foot">
			<!-- doc 16 §4: permanent, not conditional on anything. -->
			<p class="tp-mkd__disclaimer">{m['widget.markets.disclaimer']()}</p>
			{#if isStock}
				<!-- doc 09 §1's "delayed/cached — not for trading". -->
				<p class="tp-mkd__disclaimer">{m['widget.markets.stock_note']()}</p>
			{/if}
			{#each credits as credit (credit)}
				<p class="tp-mkd__credit">{credit}</p>
			{/each}
		</footer>
	{/if}
</div>

<style>
	.tp-mkd {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.tp-mkd__head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.tp-mkd__ident {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.tp-mkd__symbol {
		margin: 0;
		color: var(--color-fg);
		font-size: var(--text-lg);
	}

	.tp-mkd__pick {
		display: flex;
		align-items: baseline;
		gap: 0.375rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-mkd__figures {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.75rem;
	}

	.tp-mkd__price {
		color: var(--color-fg);
		font-size: var(--text-lg);
	}

	.tp-mkd__change {
		color: var(--color-fg-mute);
		font-size: var(--text-sm);
	}

	.tp-mkd__change--up {
		color: var(--color-up);
	}

	.tp-mkd__change--down {
		color: var(--color-down);
	}

	.tp-mkd__band {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mkd__ranges {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border: 0;
		margin: 0;
		padding: 0;
	}

	.tp-mkd__ranges-legend {
		padding: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mkd__range {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		padding-block: 0.25rem;
		padding-inline: 0.5rem;
	}

	.tp-mkd__range--on {
		border-color: var(--color-accent);
		color: var(--color-accent);
	}

	.tp-mkd__range:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.tp-mkd__note,
	.tp-mkd__empty {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.tp-mkd__manage {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
	}

	.tp-mkd__manage-heading {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		font-weight: 500;
		text-transform: uppercase;
	}

	.tp-mkd__rows,
	.tp-mkd__results {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-mkd__row {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: var(--text-xs);
	}

	.tp-mkd__row-label {
		flex: 1;
		color: var(--color-fg);
	}

	.tp-mkd__row-kind {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mkd__row-btn {
		display: inline-flex;
		width: 1.75rem;
		height: 1.75rem;
		align-items: center;
		justify-content: center;
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg-mute);
		cursor: pointer;
	}

	/* One glyph for one idea: the set has a single chevron and the button that
	   means "up" turns it, the way `TpCurrencyDetail` does. Two glyphs would
	   drift apart the first time either was touched (`ui/icons/names.ts`). */
	.tp-mkd__row-btn--up {
		rotate: 180deg;
	}

	.tp-mkd__row-btn:disabled {
		color: var(--color-fg-dim);
		cursor: default;
		opacity: 0.4;
	}

	.tp-mkd__row-btn:focus-visible,
	.tp-mkd__add-btn:focus-visible,
	.tp-mkd__add-input:focus-visible,
	.tp-mkd__add-kind:focus-visible,
	.tp-mkd__result:focus-visible {
		outline: 2px solid var(--color-accent);
		outline-offset: 2px;
	}

	.tp-mkd__add {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.tp-mkd__add-label {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mkd__add-input,
	.tp-mkd__add-kind {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		padding-block: 0.25rem;
		padding-inline: 0.5rem;
	}

	.tp-mkd__add-input {
		width: 9rem;
	}

	.tp-mkd__add-btn {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		padding-block: 0.25rem;
		padding-inline: 0.5rem;
	}

	.tp-mkd__result {
		display: flex;
		width: 100%;
		align-items: baseline;
		gap: 0.5rem;
		border: 0;
		border-radius: var(--radius-ctl);
		background: transparent;
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding-block: 0.25rem;
		padding-inline: 0.25rem;
		text-align: left;
	}

	.tp-mkd__result:hover:not(:disabled) {
		background: var(--color-ink-850);
	}

	.tp-mkd__result:disabled {
		color: var(--color-fg-dim);
		cursor: default;
	}

	.tp-mkd__result-symbol {
		min-width: 4rem;
	}

	.tp-mkd__result-name {
		overflow: hidden;
		color: var(--color-fg-mute);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-mkd__refusal,
	.tp-mkd__hint {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-mkd__foot {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		border-top: 1px solid var(--color-ink-700);
		padding-top: 0.5rem;
	}

	.tp-mkd__disclaimer,
	.tp-mkd__credit {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
