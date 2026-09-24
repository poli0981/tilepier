import { describe, expect, it } from 'vitest';
import { declaredZone, parseFeedDate } from './feed-date';

/**
 * doc 08 §4: "mixed-date formats (RFC822/ISO) normalized server-side". Every
 * expectation is written as `Date.UTC(...)`, so a case reads as the instant it
 * means and none of them depends on the zone of the machine running it — which
 * is the bug `Date.parse` would have brought (feed-date.ts says why).
 */

const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) =>
	Date.UTC(y, mo - 1, d, h, mi, s);

describe('RFC 822 (RSS 2.0)', () => {
	it.each([
		['Tue, 22 Sep 2026 10:00:00 +0700', at(2026, 9, 22, 3)],
		['Tue, 22 Sep 2026 10:00:00 GMT', at(2026, 9, 22, 10)],
		['22 Sep 2026 10:00 GMT', at(2026, 9, 22, 10)],
		['Tuesday, 22 September 2026 10:00:00 +0700', at(2026, 9, 22, 3)],
		['Tue, 22 Sep 26 10:00:00 EST', at(2026, 9, 22, 15)],
		['Tue, 22 Sep 2026 10:00:00 -05:00', at(2026, 9, 22, 15)],
		['Tue, 22 Sep 2026 10:00:00 GMT+7', at(2026, 9, 22, 3)],
		['Tue, 22 Sep 2026 10:00:00 UTC+07:00', at(2026, 9, 22, 3)],
		['Tue, 22 Sep 2026 10:00:00 ICT', at(2026, 9, 22, 3)],
		['Tue, 22 Sep 2026 10:00:00', at(2026, 9, 22, 10)],
		['Tue, 22 Sep 2026 10:00:00 Z', at(2026, 9, 22, 10)],
		// RFC 822's military letters are unreliable in the wild; read as UTC.
		['Tue, 22 Sep 2026 10:00:00 A', at(2026, 9, 22, 10)],
		['Tue, 2 Sep 2026 9:05:00 +0000', at(2026, 9, 2, 9, 5)],
		['Tue, 22 Sep 2026 10:00:00.123 +0000', at(2026, 9, 22, 10)]
	])('%s', (raw, expected) => {
		expect(parseFeedDate(raw)).toBe(expected);
	});

	it('reads a two-digit year the way RFC 2822 does', () => {
		expect(parseFeedDate('01 Jan 49 00:00:00 GMT')).toBe(at(2049, 1, 1));
		// 1950 is before 1990, which no feed publishes from.
		expect(parseFeedDate('01 Jan 50 00:00:00 GMT')).toBeNull();
	});
});

describe('ISO 8601 / RFC 3339 (Atom, Dublin Core)', () => {
	it.each([
		['2026-09-22T10:00:00Z', at(2026, 9, 22, 10)],
		['2026-09-22T10:00:00+07:00', at(2026, 9, 22, 3)],
		['2026-09-22T10:00:00.512-04:00', at(2026, 9, 22, 14)],
		['2026-09-22 10:00:00Z', at(2026, 9, 22, 10)],
		['2026-09-22T10:00Z', at(2026, 9, 22, 10)],
		['2026-09-22', at(2026, 9, 22)]
	])('%s', (raw, expected) => {
		expect(parseFeedDate(raw)).toBe(expected);
	});

	it('reads a zoneless timestamp as UTC, never as the machine’s local time', () => {
		// `Date.parse` would read this as local time: seven hours off on a
		// developer's machine in Hà Nội, and right only on the Worker.
		expect(parseFeedDate('2026-09-22T10:00:00')).toBe(at(2026, 9, 22, 10));
	});
});

describe('what is not a date', () => {
	it.each([
		[''],
		['   '],
		['yesterday'],
		['Thứ Ba, 22 Tháng 9 2026'],
		['31 Feb 2026 10:00:00 GMT'],
		['2026-02-31'],
		['2026-13-01'],
		['Tue, 22 Sep 2026 25:00:00 GMT'],
		['Tue, 22 Sep 2026 10:00:00 +9900'],
		['01 Jan 1970 00:00:00 GMT']
	])('%j is null', (raw) => {
		expect(parseFeedDate(raw)).toBeNull();
	});

	it('is null for nothing at all', () => {
		expect(parseFeedDate(undefined)).toBeNull();
		expect(parseFeedDate(null)).toBeNull();
	});
});

describe(".NET's M/D/YYYY (Tuổi Trẻ, measured 2026-09-24)", () => {
	it.each([
		['9/24/2026 9:41:00 PM', at(2026, 9, 24, 21, 41)],
		['9/24/2026 9:41 PM', at(2026, 9, 24, 21, 41)],
		['12/1/2026 12:05:00 AM', at(2026, 12, 1, 0, 5)],
		['12/1/2026 12:05:00 PM', at(2026, 12, 1, 12, 5)],
		// No AM/PM: a field over 12 says which one is the day.
		['24/9/2026 21:41', at(2026, 9, 24, 21, 41)],
		['9/24/2026 21:41', at(2026, 9, 24, 21, 41)]
	])('%s', (raw, expected) => {
		expect(parseFeedDate(raw)).toBe(expected);
	});

	it.each([
		// Both fields could be the month: September or October depends on the country.
		['9/10/2026 21:41'],
		['9/24/2026 13:00 PM'],
		['9/24/2026 0:30 AM']
	])('%j is null rather than a guess', (raw) => {
		expect(parseFeedDate(raw)).toBeNull();
	});
});

describe('the zone a date names, and the one assumed when it names none', () => {
	it('reports a declared zone, and null when there is none', () => {
		expect(declaredZone('Thu, 24 Sep 2026 21:49:47 GMT+7')).toBe(420);
		expect(declaredZone('2026-09-22T10:00:00Z')).toBe(0);
		expect(declaredZone('2026-09-22T10:00:00-05:00')).toBe(-300);
		expect(declaredZone('2026-09-22T10:00:00')).toBeNull();
		expect(declaredZone('9/24/2026 9:41:00 PM')).toBeNull();
		expect(declaredZone('not a date')).toBeNull();
	});

	it('applies the assumed zone only to a date that names none', () => {
		expect(parseFeedDate('9/24/2026 9:41:00 PM', 420)).toBe(at(2026, 9, 24, 14, 41));
		expect(parseFeedDate('2026-09-22T10:00:00', 420)).toBe(at(2026, 9, 22, 3));
		// A written zone wins over any assumption.
		expect(parseFeedDate('Tue, 22 Sep 2026 10:00:00 GMT', 420)).toBe(at(2026, 9, 22, 10));
	});
});
