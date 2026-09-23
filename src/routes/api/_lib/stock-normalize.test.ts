import { describe, expect, it } from 'vitest';
import { normalizeStockQuote, normalizeStockSearch, normalizeStockSeries } from './normalize';

/**
 * The stock half of "upstream shapes die here" (doc 11 §1.4). Finnhub sends
 * numbers and answers an unknown symbol with zeros; Twelve Data sends strings
 * and stamps bars in whatever zone it was asked for. Each case is a way one of
 * them could hand the UI something that looks like a price and is not.
 */

const NOW = Date.parse('2026-09-23T15:00:00Z');

describe('normalizeStockQuote', () => {
	it('reads a Finnhub quote into the row shape, with the move as a fraction', () => {
		const quote = normalizeStockQuote(
			{ c: 227.52, d: 1.84, dp: 0.8153, h: 228.9, l: 225.1, o: 225.6, pc: 225.68, t: 1790175600 },
			'AAPL',
			NOW
		);
		expect(quote).toEqual({
			symbol: 'AAPL',
			price: 227.52,
			changeDay: 0.008153,
			high: 228.9,
			low: 225.1,
			open: 225.6,
			prevClose: 225.68,
			at: 1790175600 * 1000
		});
	});

	it('is null for the all-zero answer Finnhub gives a symbol it does not know', () => {
		expect(
			normalizeStockQuote({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }, 'NOPE', NOW)
		).toBeNull();
	});

	it('keeps a priced row whose other figures are missing, as nulls not zeros', () => {
		const quote = normalizeStockQuote({ c: 10, h: 0, dp: null }, 'X', NOW);
		expect(quote).toMatchObject({ price: 10, high: null, changeDay: null, at: NOW });
	});

	it('refuses garbage without throwing', () => {
		for (const body of [null, 'text', [], { c: 'abc' }, { c: -5 }]) {
			expect(normalizeStockQuote(body, 'X', NOW), JSON.stringify(body)).toBeNull();
		}
	});
});

describe('normalizeStockSeries', () => {
	const body = {
		meta: { symbol: 'AAPL', interval: '15min' },
		values: [
			{
				datetime: '2026-09-22 19:45:00',
				open: '227',
				high: '228',
				low: '226.5',
				close: '227.5',
				volume: '1200'
			},
			{
				datetime: '2026-09-22 19:30:00',
				open: '226',
				high: '227.2',
				low: '225.9',
				close: '227',
				volume: '900'
			},
			{ datetime: 'not a time', open: '1', high: '1', low: '1', close: '1', volume: '1' },
			{ datetime: '2026-09-22 20:00:00', open: '0', high: '1', low: '1', close: '1', volume: '1' }
		],
		status: 'ok'
	};

	it('reads UTC bar times, drops unreadable and non-positive bars, and sorts ascending', () => {
		const series = normalizeStockSeries(body, 'AAPL', '15min');

		expect(series.candles.map((c) => c[0])).toEqual([
			Date.parse('2026-09-22T19:30:00Z'),
			Date.parse('2026-09-22T19:45:00Z')
		]);
		expect(series.candles[1]).toEqual([
			Date.parse('2026-09-22T19:45:00Z'),
			227,
			228,
			226.5,
			227.5,
			1200
		]);
		expect(series.attribution).toMatch(/Twelve Data/);
	});

	it('reads a daily bar, which carries a date and no time, as UTC midnight', () => {
		const series = normalizeStockSeries(
			{ values: [{ datetime: '2026-09-22', open: '1', high: '2', low: '0.5', close: '1.5' }] },
			'AAPL',
			'1day'
		);
		// No volume (an index has none) is 0, not a reason to lose the bar.
		expect(series.candles).toEqual([[Date.parse('2026-09-22T00:00:00Z'), 1, 2, 0.5, 1.5, 0]]);
	});

	it('is an empty series for an error body or no values at all', () => {
		expect(normalizeStockSeries({ status: 'error', code: 400 }, 'X', '1day').candles).toEqual([]);
		expect(normalizeStockSeries(null, 'X', '1day').candles).toEqual([]);
	});
});

describe('normalizeStockSearch', () => {
	it('keeps common stock the watchlist would accept, once each, as text', () => {
		const payload = normalizeStockSearch(
			{
				count: 5,
				result: [
					{ description: 'APPLE INC', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' },
					{ description: 'APPLE INC', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' },
					{ description: 'APPLE HOSPITALITY', symbol: 'APLE', type: 'REIT' },
					{ description: 'BERKSHIRE HATHAWAY-CL B', symbol: 'BRK.B', type: 'Common Stock' },
					{ description: '<b>X</b>', symbol: 'WAY TOO LONG SYMBOL', type: 'Common Stock' }
				]
			},
			'apple'
		);

		expect(payload.results).toEqual([
			{ symbol: 'AAPL', name: 'APPLE INC' },
			{ symbol: 'BRK.B', name: 'BERKSHIRE HATHAWAY-CL B' }
		]);
		expect(payload.attribution).toMatch(/Finnhub/);
	});

	it('stops at ten', () => {
		const result = Array.from({ length: 30 }, (_, i) => ({
			description: `CO ${String(i)}`,
			symbol: `S${String(i)}`,
			type: 'Common Stock'
		}));
		expect(normalizeStockSearch({ result }, 's').results).toHaveLength(10);
	});
});
