import { describe, expect, it } from 'vitest';
import { dateKeyOf, dayKeysBack } from './date-key';

/**
 * Carried over from `widgets/timer/service.test.ts` and
 * `widgets/todo/service.test.ts`, which each tested their own copy of
 * `dateKeyOf`. Both copies were identical and both are gone.
 */

describe('dateKeyOf', () => {
	it('reads the local date, not the UTC one', () => {
		// Built from local Date parts on both sides, so this asserts local-ness
		// on any runner rather than only on one east of Greenwich.
		expect(dateKeyOf(new Date(2026, 7, 27, 23, 59))).toBe('2026-08-27');
		expect(dateKeyOf(new Date(2026, 7, 28, 0, 0))).toBe('2026-08-28');
	});

	it('zero-pads, so the keys sort lexicographically', () => {
		// Dexie ranges over this index; unpadded months would order 10 before 2.
		expect(dateKeyOf(new Date(2026, 0, 5))).toBe('2026-01-05');
		expect(dateKeyOf(new Date(2026, 9, 15))).toBe('2026-10-15');
	});

	it('accepts a timestamp as readily as a Date', () => {
		const at = new Date(2026, 7, 27, 12, 0);
		expect(dateKeyOf(at.getTime())).toBe(dateKeyOf(at));
	});
});

describe('dayKeysBack', () => {
	it('ends at today and runs oldest first', () => {
		const keys = dayKeysBack(new Date(2026, 7, 28, 15, 0), 3);
		expect(keys).toEqual(['2026-08-26', '2026-08-27', '2026-08-28']);
	});

	it('walks across a month boundary', () => {
		expect(dayKeysBack(new Date(2026, 8, 1, 9, 0), 3)).toEqual([
			'2026-08-30',
			'2026-08-31',
			'2026-09-01'
		]);
	});

	it('walks across a leap day', () => {
		expect(dayKeysBack(new Date(2028, 2, 1, 9, 0), 3)).toEqual([
			'2028-02-28',
			'2028-02-29',
			'2028-03-01'
		]);
	});

	it('returns exactly the number of days asked for, with no gaps', () => {
		// A history strip with gaps in it lies about its own x-axis: fourteen
		// bars always means fourteen days (doc 07 §2).
		const keys = dayKeysBack(Date.now(), 14);
		expect(keys).toHaveLength(14);
		expect(new Set(keys).size).toBe(14);
	});

	it('gives an empty list for a zero-day window rather than throwing', () => {
		expect(dayKeysBack(Date.now(), 0)).toEqual([]);
	});

	it('accepts a timestamp as readily as a Date', () => {
		const at = new Date(2026, 7, 28, 15, 0);
		expect(dayKeysBack(at.getTime(), 3)).toEqual(dayKeysBack(at, 3));
	});

	it('does not mutate the Date it was handed', () => {
		const at = new Date(2026, 7, 28, 15, 0);
		const before = at.getTime();
		dayKeysBack(at, 5);
		expect(at.getTime()).toBe(before);
	});
});
