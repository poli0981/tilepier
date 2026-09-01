import { describe, expect, it } from 'vitest';
import type { TpCryptoQuote, TpCryptoTickerPayload } from '$lib/api-types';
import { cacheKey, symbolSetKey } from '$lib/shared-constants';
import {
	cryptoLookup,
	labelOf,
	priceDigits,
	readSettings,
	rowsFor,
	symbolsOf,
	tickerKey,
	tickerUrl
} from './service';
import { MARKETS_DEFAULTS, MAX_DISPLAY, MAX_WATCHLIST } from './types';

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
