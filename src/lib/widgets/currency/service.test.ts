import { describe, expect, it } from 'vitest';
import { FX_PAYLOAD, FX_PAYLOAD_DAY_ONE } from '$lib/core/__fixtures__/fx';
import { cacheKey } from '$lib/shared-constants';
import { change24h, convert, currencyCodes, fxKey, fxUrl, rateFor, readSettings } from './service';
import { CURRENCY_DEFAULTS, MAX_AMOUNT } from './types';

/**
 * The currency tile's decisions, in the node project — everything here is pure
 * but `fxSource`, which is the component tests' business.
 */

describe('the data key (doc 04 §5)', () => {
	it('is the Worker’s own spelling, and does not move with the pair', () => {
		// The endpoint takes no parameters, so one cached USD table answers every
		// pair and the division happens on this side. That is what lets the tile
		// live in one component instead of weather's two.
		expect(fxKey()).toBe(cacheKey.fx());
		expect(fxUrl()).toBe('/api/fx');
	});
});

describe('reading settings', () => {
	it('lands on USD→VND for a bag with nothing in it', () => {
		expect(readSettings({})).toEqual(CURRENCY_DEFAULTS);
	});

	it('accepts a lowercase or padded code, because a hand-edited layout is prose', () => {
		expect(readSettings({ base: ' eur ', quote: 'jpy' })).toMatchObject({
			base: 'EUR',
			quote: 'JPY'
		});
	});

	it('falls back per field rather than discarding the whole bag', () => {
		// The reader's quote survives even though their base is nonsense — losing
		// both because one was wrong is how a fail-closed reader becomes a reset.
		expect(readSettings({ base: 'not-a-code', quote: 'THB' })).toMatchObject({
			base: CURRENCY_DEFAULTS.base,
			quote: 'THB'
		});
	});

	it('refuses codes that are not three letters', () => {
		for (const base of ['US', 'USDD', '123', '', 42, null, undefined, {}]) {
			expect(readSettings({ base }).base, String(base)).toBe(CURRENCY_DEFAULTS.base);
		}
	});

	it('refuses an amount that is not a number the tile can draw', () => {
		for (const amount of ['3', Number.NaN, Number.POSITIVE_INFINITY, -1, MAX_AMOUNT + 1]) {
			expect(readSettings({ amount }).amount, String(amount)).toBe(CURRENCY_DEFAULTS.amount);
		}
	});

	it('keeps zero, which is a legitimate thing to convert', () => {
		expect(readSettings({ amount: 0 }).amount).toBe(0);
	});
});

describe('the maths', () => {
	it('cross-rates through the USD table', () => {
		expect(rateFor(FX_PAYLOAD, 'USD', 'VND')).toBe(FX_PAYLOAD.rates['VND']);
		// EUR→VND is VND-per-USD over EUR-per-USD, which is the whole reason the
		// endpoint needs no parameters.
		expect(rateFor(FX_PAYLOAD, 'EUR', 'VND')).toBeCloseTo(
			(FX_PAYLOAD.rates['VND'] as number) / (FX_PAYLOAD.rates['EUR'] as number),
			6
		);
	});

	it('is exactly 1 for a code against itself, without consulting the table', () => {
		// True even for a code upstream dropped: a currency is always one of
		// itself, and answering `null` there would mark a working pair unavailable.
		expect(rateFor(FX_PAYLOAD, 'ZWL', 'ZWL')).toBe(1);
	});

	it('reports nothing for a code the table does not quote', () => {
		// doc 08 §2's edge case. `null` rather than `NaN`, because the tile has
		// something to say about the first and nothing to say about the second.
		expect(rateFor(FX_PAYLOAD, 'USD', 'ZWL')).toBeNull();
		expect(rateFor(FX_PAYLOAD, 'ZWL', 'USD')).toBeNull();
		expect(convert(FX_PAYLOAD, 100, 'USD', 'ZWL')).toBeNull();
	});

	it('converts an amount, and zero stays zero', () => {
		expect(convert(FX_PAYLOAD, 2, 'USD', 'VND')).toBeCloseTo(
			2 * (FX_PAYLOAD.rates['VND'] as number),
			4
		);
		expect(convert(FX_PAYLOAD, 0, 'USD', 'VND')).toBe(0);
	});
});

describe('the 24 h change (doc 08 §2)', () => {
	it('is the move from yesterday’s table', () => {
		const now = FX_PAYLOAD.rates['VND'] as number;
		const before = (FX_PAYLOAD.prevRates as Record<string, number>)['VND'] as number;

		expect(change24h(FX_PAYLOAD, 'USD', 'VND')).toBeCloseTo((now - before) / before, 12);
	});

	it('reports nothing on the day the app deploys', () => {
		// Not zero. A 0.00 % is a claim about the market; an absent figure is the
		// truth about what we know, and the tile renders no change at all.
		expect(change24h(FX_PAYLOAD_DAY_ONE, 'USD', 'VND')).toBeNull();
	});

	it('reports nothing for a pair yesterday did not quote', () => {
		// Today's table dropped ZWL; yesterday's still has it. Neither direction
		// can produce a change, and neither may produce a NaN.
		expect(change24h(FX_PAYLOAD, 'USD', 'ZWL')).toBeNull();
		expect(change24h(FX_PAYLOAD, 'ZWL', 'USD')).toBeNull();
	});

	it('is zero only when the rate genuinely did not move', () => {
		expect(change24h(FX_PAYLOAD, 'USD', 'USD')).toBe(0);
	});
});

describe('the code list for the pickers', () => {
	it('is every code the table quotes, sorted', () => {
		const codes = currencyCodes(FX_PAYLOAD);
		expect(codes).toEqual([...codes].sort());
		expect(codes).toContain('VND');
		expect(codes).toContain('USD');
	});

	it('keeps a stored code upstream dropped, so the reader can get out of it', () => {
		// A picker that hid the unavailable code would leave the tile stuck on a
		// pair it cannot change — the state doc 08 §2 asks be marked, not trapped.
		expect(currencyCodes(FX_PAYLOAD, 'ZWL')).toContain('ZWL');
	});

	it('is empty before anything has loaded, rather than throwing', () => {
		expect(currencyCodes(undefined)).toEqual([]);
		expect(currencyCodes(undefined, 'USD', 'not-a-code')).toEqual(['USD']);
	});
});
