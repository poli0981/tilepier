import { describe, expect, it } from 'vitest';
import type { TpCryptoQuote, TpCryptoTickerPayload } from '$lib/api-types';
import { CRYPTO_RANGES } from '$lib/api-types';
import { cacheKey, symbolSetKey } from '$lib/shared-constants';
import {
	cryptoLookup,
	labelOf,
	priceDigits,
	readSettings,
	rowsFor,
	symbolsOf,
	tickerKey,
	tickerUrl,
	klinesKey,
	klinesUrl,
	downsample,
	sparklinePoints,
	SPARK_POINTS,
	addToWatchlist,
	removeFromWatchlist,
	moveInWatchlist,
	suggestions
} from './service';
import { CRYPTO_TOP_LIST, MARKETS_DEFAULTS, MAX_DISPLAY, MAX_WATCHLIST } from './types';

/**
 * doc 09 §1's tile logic, tested without a DOM — everything the tile decides is
 * a pure function of the settings bag and the payload, which is the shape
 * `weather/service.ts` and `currency/service.ts` established.
 */

function quote(symbol: string, price: number, change: number | null = 0.01): TpCryptoQuote {
	return {
		symbol,
		price,
		change24h: change,
		high24h: price,
		low24h: price,
		volume24h: 1,
		at: 1_788_000_000_000
	};
}

describe('readSettings', () => {
	it('falls back to the default watchlist for a bag with no list at all', () => {
		expect(readSettings({}).watchlist).toEqual(MARKETS_DEFAULTS.watchlist);
		expect(readSettings({ watchlist: 'BTCUSDT' }).watchlist).toEqual(MARKETS_DEFAULTS.watchlist);
	});

	it('keeps an empty watchlist, because removing every row is a choice', () => {
		// doc 06 §3's `empty` state for this widget. Falling back to the defaults
		// here would put back rows the reader had just deleted.
		expect(readSettings({ watchlist: [] }).watchlist).toEqual([]);
	});

	it('drops entries a hand-edited layout could carry', () => {
		const { watchlist } = readSettings({
			watchlist: [
				{ kind: 'crypto', symbol: 'btcusdt', display: '  BTC  ' },
				{ kind: 'commodity', symbol: 'GOLD', display: '' },
				{ kind: 'crypto', symbol: 'BTC/USDT', display: '' },
				{ kind: 'crypto' },
				'ETHUSDT',
				null
			]
		});

		expect(watchlist).toEqual([{ kind: 'crypto', symbol: 'BTCUSDT', display: 'BTC' }]);
	});

	it('de-duplicates on kind *and* symbol, not on symbol alone', () => {
		const { watchlist } = readSettings({
			watchlist: [
				{ kind: 'crypto', symbol: 'AAPL', display: '' },
				{ kind: 'stock', symbol: 'AAPL', display: '' },
				{ kind: 'stock', symbol: 'AAPL', display: 'again' }
			]
		});

		// The same string means different questions to different upstreams.
		expect(watchlist).toHaveLength(2);
		expect(watchlist.map((e) => e.kind)).toEqual(['crypto', 'stock']);
	});

	it('stops at the documented cap rather than rendering a hand-edited hundred', () => {
		const many = Array.from({ length: 40 }, (_, i) => ({
			kind: 'crypto',
			symbol: `SYM${String(i)}`,
			display: ''
		}));

		expect(readSettings({ watchlist: many }).watchlist).toHaveLength(MAX_WATCHLIST);
	});

	it('trims a rename to something a row can render', () => {
		const { watchlist } = readSettings({
			watchlist: [{ kind: 'crypto', symbol: 'BTCUSDT', display: 'x'.repeat(40) }]
		});

		expect(watchlist[0]?.display).toHaveLength(MAX_DISPLAY);
	});
});

describe('labels and symbol sets', () => {
	it('falls back to the symbol when nothing was renamed', () => {
		expect(labelOf({ kind: 'crypto', symbol: 'BTCUSDT', display: '' })).toBe('BTCUSDT');
		expect(labelOf({ kind: 'crypto', symbol: 'BTCUSDT', display: 'BTC' })).toBe('BTC');
	});

	it('splits a mixed watchlist by kind', () => {
		const watchlist = [
			{ kind: 'crypto' as const, symbol: 'BTCUSDT', display: '' },
			{ kind: 'stock' as const, symbol: 'AAPL', display: '' },
			{ kind: 'crypto' as const, symbol: 'ETHUSDT', display: '' }
		];

		expect(symbolsOf(watchlist, 'crypto')).toEqual(['BTCUSDT', 'ETHUSDT']);
		expect(symbolsOf(watchlist, 'stock')).toEqual(['AAPL']);
	});
});

describe('the data key and the request', () => {
	it('spells the key the way the Worker spells it (doc 04 §5)', () => {
		expect(tickerKey(['ETHUSDT', 'BTCUSDT'])).toBe(
			cacheKey.cryptoTicker(symbolSetKey(['BTCUSDT', 'ETHUSDT']))
		);
	});

	it('does not move the key when the reader reorders the watchlist', () => {
		// The order is a display concern; the cache is about the set.
		expect(tickerKey(['ETHUSDT', 'BTCUSDT'])).toBe(tickerKey(['BTCUSDT', 'ETHUSDT']));
	});

	it('sends the canonical set upstream, not the display order', () => {
		// The response is CDN-cacheable by URL, so sending the reader's order
		// would give every arrangement of one watchlist its own edge entry for the
		// same answer.
		expect(tickerUrl(['ETHUSDT', 'BTCUSDT'])).toBe(tickerUrl(['BTCUSDT', 'ETHUSDT']));
		expect(tickerUrl(['ETHUSDT', 'BTCUSDT'])).toContain('BTCUSDT%2CETHUSDT');
	});
});

describe('rows', () => {
	const watchlist = [
		{ kind: 'crypto' as const, symbol: 'BTCUSDT', display: 'BTC' },
		{ kind: 'crypto' as const, symbol: 'GONEUSDT', display: '' },
		{ kind: 'stock' as const, symbol: 'AAPL', display: '' }
	];

	const payload: TpCryptoTickerPayload = {
		quotes: { BTCUSDT: quote('BTCUSDT', 62_910.53), GONEUSDT: null },
		attribution: 'Crypto data by Binance'
	};

	it('keeps the reader order, and the reader labels', () => {
		const rows = rowsFor(watchlist, cryptoLookup(payload));

		expect(rows.map((r) => r.label)).toEqual(['BTC', 'GONEUSDT', 'AAPL']);
	});

	it('carries a null for a symbol upstream had nothing for', () => {
		const rows = rowsFor(watchlist, cryptoLookup(payload));

		expect(rows[0]?.quote?.price).toBe(62_910.53);
		expect(rows[1]?.quote).toBeNull();
	});

	it('leaves a stock row unanswered rather than reading it out of a crypto table', () => {
		// 5b supplies the second lookup. Until then the row exists, has no quote,
		// and the tile says so — which is the same rendering as a delisted coin.
		const rows = rowsFor(watchlist, cryptoLookup(payload));

		expect(rows[2]?.quote).toBeNull();
	});

	it('answers null for everything before a payload has arrived', () => {
		const rows = rowsFor(watchlist, cryptoLookup(undefined));

		expect(rows.every((row) => row.quote === null)).toBe(true);
	});
});

describe('priceDigits (doc 09 §1)', () => {
	it('gives a sub-cent alt enough places to be a number at all', () => {
		expect(priceDigits(0.000_012_3)).toBe(6);
		expect(priceDigits(0.42)).toBe(4);
		expect(priceDigits(62_910.53)).toBe(2);
		expect(priceDigits(1)).toBe(2);
	});

	it('keys off magnitude rather than off a list of coins', () => {
		// A hard-coded list would be wrong the first week a new coin is added, and
		// wrong again for a stock that trades under a dollar.
		expect(priceDigits(0.009)).toBe(6);
		expect(priceDigits(0.011)).toBe(4);
	});
});

describe('the candle key and request', () => {
	it('spells the key the way the Worker spells it, with no range in it', () => {
		// doc 11 §4 keys this payload by symbol and interval only. The depth is a
		// property of the *response*, so two ranges over one interval share an
		// entry — 1M and 1Y are one subscription, and switching is free.
		expect(klinesKey('BTCUSDT', '1d')).toBe(cacheKey.cryptoKlines('BTCUSDT', '1d'));
		expect(klinesKey('BTCUSDT', '1d')).not.toContain('365');
	});

	it('sends the interval and depth the range set names', () => {
		for (const [name, range] of Object.entries(CRYPTO_RANGES)) {
			const url = klinesUrl('BTCUSDT', range.interval, range.limit);

			expect(url, name).toContain(`interval=${range.interval}`);
			expect(url, name).toContain(`limit=${String(range.limit)}`);
		}
	});

	it('asks only for depths the endpoint will answer for', () => {
		// The endpoint refuses anything outside the range set — a `BAD_REQUEST`
		// rather than a clamp — so the picker and the validator have to agree, and
		// they agree by both reading `CRYPTO_RANGES`.
		const limits = Object.values(CRYPTO_RANGES).map((r) => r.limit);

		expect(new Set(limits).size).toBe(limits.length);
		expect(limits.every((limit) => limit > 0 && limit <= 500)).toBe(true);
	});
});

/**
 * doc 09 §1's micro-sparkline, minus the Dexie read.
 *
 * `peekSparkline` itself is exercised in the browser project, where there is a
 * real IndexedDB to peek into; what is worth asserting here is the arithmetic
 * it hands to the polyline, because that is where a shape can be quietly wrong.
 */
describe('the sparkline shape', () => {
	/** `[t, open, high, low, close, volume]` — only the close is read. */
	const series = (closes: readonly number[]) =>
		closes.map((close, i) => [i, close, close, close, close, 1] as const);

	it('keeps the last point, whatever the thinning', () => {
		const values = downsample(series(Array.from({ length: 500 }, (_, i) => i)));

		// A sparkline whose right-hand end is not the latest close disagrees with
		// the price rendered beside it, which is the one inconsistency a reader
		// would actually notice.
		expect(values).toHaveLength(SPARK_POINTS);
		expect(values.at(-1)).toBe(499);
		expect(values[0]).toBe(0);
	});

	it('leaves a short series alone rather than padding it', () => {
		expect(downsample(series([1, 2, 3]))).toEqual([1, 2, 3]);
		expect(downsample(series([]))).toEqual([]);
	});

	it('scales to the series own band, not to zero', () => {
		// A market that moved 0.4 % is a flat line against an axis anchored at
		// zero, and a flat line is what a sparkline exists to disprove. The
		// detail's y axis sets `scale: true` for the same reason.
		const points = sparklinePoints([100, 100.2, 100.4], 40, 12);

		// Lowest value at the bottom, highest at the top — SVG y grows downward.
		expect(points).toBe('0.00,12.00 20.00,6.00 40.00,0.00');
	});

	it('draws a market that did not move down the middle', () => {
		expect(sparklinePoints([5, 5, 5], 40, 12)).toBe('0.00,6.00 20.00,6.00 40.00,6.00');
	});

	it('has nothing to draw from fewer than two points', () => {
		expect(sparklinePoints([1], 40, 12)).toBe('');
		expect(sparklinePoints([], 40, 12)).toBe('');
	});
});

describe('the watchlist manager (doc 09 §1)', () => {
	const one = [{ kind: 'crypto' as const, symbol: 'BTCUSDT', display: 'BTC' }];

	it('appends a symbol it has never seen', () => {
		const edit = addToWatchlist(one, 'crypto', ' ethusdt ');

		expect(edit.refused).toBeNull();
		expect(edit.watchlist.map((e) => e.symbol)).toEqual(['BTCUSDT', 'ETHUSDT']);
	});

	it('accepts a coin listed this morning, because nothing here can know', () => {
		// Validation is doc 10 §5's allowlist, not a guess at whether the coin
		// exists. doc 09 §1 already has a rendering for a symbol upstream will not
		// quote: the row appears and is marked.
		expect(addToWatchlist(one, 'crypto', 'BRANDNEW1').refused).toBeNull();
	});

	it('says which of the three refusals it was', () => {
		// One "could not add that" for all three would send a reader looking for
		// the wrong problem: a full list is acted on by removing a row, a
		// duplicate is already on screen, a bad symbol is a typo.
		expect(addToWatchlist(one, 'crypto', 'BTC/USDT').refused).toBe('invalid');
		expect(addToWatchlist(one, 'crypto', 'btcusdt').refused).toBe('duplicate');

		const full = Array.from({ length: MAX_WATCHLIST }, (_, i) => ({
			kind: 'crypto' as const,
			symbol: `SYM${String(i)}`,
			display: ''
		}));
		expect(addToWatchlist(full, 'crypto', 'ETHUSDT').refused).toBe('full');
	});

	it('leaves the list untouched on every refusal', () => {
		for (const raw of ['BTC/USDT', 'btcusdt']) {
			expect(addToWatchlist(one, 'crypto', raw).watchlist).toEqual(one);
		}
	});

	it('treats the same symbol under two kinds as two entries', () => {
		const edit = addToWatchlist([{ kind: 'stock', symbol: 'AAPL', display: '' }], 'crypto', 'AAPL');

		expect(edit.refused).toBeNull();
		expect(edit.watchlist).toHaveLength(2);
	});

	it('removes by kind and symbol together', () => {
		const both = [
			{ kind: 'crypto' as const, symbol: 'AAPL', display: '' },
			{ kind: 'stock' as const, symbol: 'AAPL', display: '' }
		];

		expect(removeFromWatchlist(both, 'stock', 'AAPL')).toEqual([both[0]]);
	});

	it('moves a row, and stops rather than wrapping at either end', () => {
		const three = ['A', 'B', 'C'].map((symbol) => ({
			kind: 'crypto' as const,
			symbol,
			display: ''
		}));

		expect(moveInWatchlist(three, 1, -1).map((e) => e.symbol)).toEqual(['B', 'A', 'C']);
		// A reader pressing "up" on the first row means "nothing above this";
		// jumping it to the bottom is a different action than the one they asked
		// for.
		expect(moveInWatchlist(three, 0, -1).map((e) => e.symbol)).toEqual(['A', 'B', 'C']);
		expect(moveInWatchlist(three, 2, 1).map((e) => e.symbol)).toEqual(['A', 'B', 'C']);
		expect(moveInWatchlist(three, 9, 1).map((e) => e.symbol)).toEqual(['A', 'B', 'C']);
	});

	it('offers only what the reader has not already taken', () => {
		expect(suggestions([])).toEqual([...CRYPTO_TOP_LIST]);
		expect(suggestions(one)).not.toContain('BTCUSDT');
		// The list is exactly the watchlist cap, so taking all of it is reachable
		// and the panel has to have something to say about it.
		const all = CRYPTO_TOP_LIST.map((symbol) => ({ kind: 'crypto' as const, symbol, display: '' }));
		expect(suggestions(all)).toEqual([]);
	});
});
