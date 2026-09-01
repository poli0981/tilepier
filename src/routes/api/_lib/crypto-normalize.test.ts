import { describe, expect, it } from 'vitest';
import { CRYPTO_ATTRIBUTION, normalizeCryptoQuote, normalizeCryptoTicker } from './normalize';

/**
 * doc 10 §4's ticker, normalised — the crypto half of `normalize.test.ts`, in
 * its own file because that one is already 400 lines of weather, geocode and fx.
 *
 * The recurring shape here is that **Binance sends numbers as strings**. A
 * reader who assumes otherwise gets `NaN` everywhere and a tile of em dashes,
 * and nothing throws to say so.
 */

const NOW = 1_788_000_000_000;

/** A trimmed real row: every numeric field is a quoted string except the two
 *  timestamps, which is exactly upstream's shape. */
const ROW = {
	symbol: 'BTCUSDT',
	priceChange: '1310.42',
	priceChangePercent: '2.126',
	lastPrice: '62910.53',
	openPrice: '61600.11',
	highPrice: '63200.00',
	lowPrice: '61200.45',
	volume: '18422.19',
	quoteVolume: '1150238811.4',
	openTime: 1_787_913_600_000,
	closeTime: 1_787_999_999_999,
	count: 1_204_881
};

describe('normalizeCryptoQuote', () => {
	it('parses the string-encoded numbers upstream actually sends', () => {
		const quote = normalizeCryptoQuote(ROW, NOW);

		expect(quote).toMatchObject({
			symbol: 'BTCUSDT',
			price: 62_910.53,
			high24h: 63_200,
			low24h: 61_200.45,
			volume24h: 18_422.19,
			at: 1_787_999_999_999
		});

		// A fraction, not a percentage: 2.126 % arrives as 0.02126 so `Intl` can
		// place the sign and the symbol (doc 09 §1).
		//
		// `toBeCloseTo` rather than `toBe`, because `2.126 / 100` is
		// 0.021259999999999998 in binary floating point. Not rounded in the
		// normalizer: rounding there would invent a precision upstream did not
		// send, and the chip renders through `Intl` at two decimals where a
		// difference of 1e-17 cannot reach the screen.
		expect(quote?.change24h).toBeCloseTo(0.02126, 12);
	});

	it('refuses a row with no usable price rather than inventing one', () => {
		expect(normalizeCryptoQuote({ ...ROW, lastPrice: undefined }, NOW)).toBeNull();
		expect(normalizeCryptoQuote({ ...ROW, lastPrice: 'not a number' }, NOW)).toBeNull();
		expect(normalizeCryptoQuote({ ...ROW, lastPrice: '' }, NOW)).toBeNull();
		// Non-positive for the reason `normalizeFx` refuses a non-positive rate:
		// it is not a number anything can divide by or draw.
		expect(normalizeCryptoQuote({ ...ROW, lastPrice: '0' }, NOW)).toBeNull();
		expect(normalizeCryptoQuote({ ...ROW, lastPrice: '-3' }, NOW)).toBeNull();
	});

	it('refuses a row with no symbol, and uppercases the one it has', () => {
		expect(normalizeCryptoQuote({ ...ROW, symbol: undefined }, NOW)).toBeNull();
		expect(normalizeCryptoQuote({ ...ROW, symbol: ' btcusdt ' }, NOW)?.symbol).toBe('BTCUSDT');
	});

	it('reports a missing change as null rather than as a flat market', () => {
		const quote = normalizeCryptoQuote({ ...ROW, priceChangePercent: undefined }, NOW);

		// doc 08 §2's sentence, transferred: a 0.00 % is a claim about the
		// market and an absent figure is the truth about what we know.
		expect(quote?.change24h).toBeNull();
		expect(quote?.price).toBe(62_910.53);
	});

	it('reports a missing range and volume as null, not as zero', () => {
		const quote = normalizeCryptoQuote(
			{ ...ROW, highPrice: undefined, lowPrice: undefined, volume: undefined },
			NOW
		);

		expect(quote?.high24h).toBeNull();
		expect(quote?.low24h).toBeNull();
		expect(quote?.volume24h).toBeNull();
	});

	it('falls back to the fetch time when upstream stamped no close', () => {
		expect(normalizeCryptoQuote({ ...ROW, closeTime: undefined }, NOW)?.at).toBe(NOW);
	});

	it('survives a body that is not an object at all', () => {
		expect(normalizeCryptoQuote(null, NOW)).toBeNull();
		expect(normalizeCryptoQuote('nope', NOW)).toBeNull();
		expect(normalizeCryptoQuote([], NOW)).toBeNull();
	});
});

describe('normalizeCryptoTicker', () => {
	const ETH = { ...ROW, symbol: 'ETHUSDT', lastPrice: '3241.09', priceChangePercent: '-1.5' };

	it('keys by every requested symbol, in the caller order', () => {
		const payload = normalizeCryptoTicker([ROW, ETH], ['ETHUSDT', 'BTCUSDT'], NOW);

		expect(Object.keys(payload.quotes)).toEqual(['ETHUSDT', 'BTCUSDT']);
		expect(payload.quotes['ETHUSDT']?.change24h).toBe(-0.015);
	});

	/**
	 * The one that matters. Upstream simply omits a symbol it has nothing for,
	 * so a payload built from the *response* would omit it too — leaving the
	 * tile unable to tell "no answer" from "never asked", which is the
	 * distinction doc 09 §1's row error chip is made of.
	 */
	it('marks a symbol upstream did not answer for, rather than dropping it', () => {
		const payload = normalizeCryptoTicker([ROW], ['BTCUSDT', 'GONEUSDT'], NOW);

		expect(Object.keys(payload.quotes)).toEqual(['BTCUSDT', 'GONEUSDT']);
		expect(payload.quotes['GONEUSDT']).toBeNull();
		expect(payload.quotes['BTCUSDT']).not.toBeNull();
	});

	it('ignores rows for symbols nobody asked about', () => {
		const payload = normalizeCryptoTicker([ROW, ETH], ['BTCUSDT'], NOW);

		expect(Object.keys(payload.quotes)).toEqual(['BTCUSDT']);
	});

	it('accepts a single object, which is what ?symbol= answers with', () => {
		// The endpoint's per-symbol fallback re-uses this one row at a time, and
		// Binance answers `?symbol=` with an object where `?symbols=` gives an
		// array.
		const payload = normalizeCryptoTicker(ROW, ['BTCUSDT'], NOW);

		expect(payload.quotes['BTCUSDT']?.price).toBe(62_910.53);
	});

	it('carries the attribution doc 16 §5 asks for', () => {
		expect(normalizeCryptoTicker([ROW], ['BTCUSDT'], NOW).attribution).toBe(CRYPTO_ATTRIBUTION);
	});

	it('answers every requested symbol with null when the body is nonsense', () => {
		const payload = normalizeCryptoTicker({ code: -1121, msg: 'Invalid symbol.' }, ['A', 'B'], NOW);

		expect(payload.quotes).toEqual({ A: null, B: null });
	});
});
