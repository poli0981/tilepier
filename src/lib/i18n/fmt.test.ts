import { describe, expect, it } from 'vitest';
import { fmtDate, fmtTime, isValidZone, zoneOffsetMinutes } from './fmt';

/**
 * doc 14 §3. Every assertion is pinned to a fixed instant and an explicit
 * locale — a test that reads the runner's clock or its default locale passes
 * on one machine and fails on the next, which is the specific failure this
 * module exists to prevent in the product.
 */

/** Winter in the northern hemisphere: London on GMT, New York on EST. */
const JANUARY = Date.parse('2026-01-15T12:00:00Z');
/** Summer: London on BST, New York on EDT. Same wall-clock UTC hour. */
const JULY = Date.parse('2026-07-15T12:00:00Z');

describe('fmtTime', () => {
	it('renders 24-hour time by default', () => {
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'UTC' })).toBe('12:00');
	});

	it('renders 12-hour time when asked', () => {
		// Locale decides the marker's spelling and spacing, so assert the shape.
		expect(fmtTime(JANUARY, 'en-US', { timeZone: 'UTC', hour12: true })).toMatch(/^12:00\s?PM$/i);
	});

	it('adds seconds only when asked', () => {
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'UTC' })).not.toMatch(/:\d\d:\d\d/);
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'UTC', seconds: true })).toBe('12:00:00');
	});

	it("formats in the requested zone rather than the runner's", () => {
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'Asia/Ho_Chi_Minh' })).toBe('19:00');
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'America/New_York' })).toBe('07:00');
	});

	it('follows the zone across a DST transition', () => {
		// The same UTC hour, six months apart. New York moves; the formatter must
		// too, without anyone doing offset arithmetic (doc 07 §1's edge case).
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'America/New_York' })).toBe('07:00');
		expect(fmtTime(JULY, 'en-GB', { timeZone: 'America/New_York' })).toBe('08:00');
	});

	it('reuses its formatter across calls without changing the answer', () => {
		// The memo in fmt.ts is keyed on the full option set; two calls differing
		// only in `timeZone` must not collide on one cached formatter.
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'UTC' })).toBe('12:00');
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'Asia/Tokyo' })).toBe('21:00');
		expect(fmtTime(JANUARY, 'en-GB', { timeZone: 'UTC' })).toBe('12:00');
	});
});

describe('fmtDate', () => {
	it('leads with a short weekday by default', () => {
		expect(fmtDate(JANUARY, 'en-GB', { timeZone: 'UTC' })).toMatch(/^Thu[, ]/);
	});

	it('drops the weekday on request', () => {
		expect(fmtDate(JANUARY, 'en-GB', { timeZone: 'UTC', weekday: 'none' })).toBe('15/01');
	});

	it('crosses the date line with the zone', () => {
		// 12:00 UTC is already the 16th in Auckland.
		expect(fmtDate(JANUARY, 'en-GB', { timeZone: 'Pacific/Auckland', weekday: 'none' })).toBe(
			'16/01'
		);
	});
});

describe('zoneOffsetMinutes', () => {
	it('reads whole-hour offsets in both directions', () => {
		expect(zoneOffsetMinutes(JANUARY, 'UTC')).toBe(0);
		expect(zoneOffsetMinutes(JANUARY, 'Asia/Ho_Chi_Minh')).toBe(420);
		expect(zoneOffsetMinutes(JANUARY, 'America/New_York')).toBe(-300);
	});

	it('reads the offsets that are not whole hours', () => {
		// Half and quarter hours are why this returns minutes rather than hours.
		expect(zoneOffsetMinutes(JANUARY, 'Asia/Kolkata')).toBe(330);
		expect(zoneOffsetMinutes(JANUARY, 'Australia/Eucla')).toBe(525);
		expect(zoneOffsetMinutes(JANUARY, 'Pacific/Chatham')).toBe(825);
	});

	it('changes with DST, on both hemispheres', () => {
		expect(zoneOffsetMinutes(JULY, 'America/New_York')).toBe(-240);
		expect(zoneOffsetMinutes(JANUARY, 'Europe/London')).toBe(0);
		expect(zoneOffsetMinutes(JULY, 'Europe/London')).toBe(60);
		// Southern hemisphere runs the other way round.
		expect(zoneOffsetMinutes(JULY, 'Pacific/Chatham')).toBe(765);
	});
});

describe('isValidZone', () => {
	it('accepts a real zone under either spelling', () => {
		expect(isValidZone('Asia/Ho_Chi_Minh')).toBe(true);
		expect(isValidZone('Asia/Saigon')).toBe(true);
		expect(isValidZone('UTC')).toBe(true);
	});

	it('rejects what the tz database does not know', () => {
		// doc 07 §1: a stored zone that stops resolving is dropped, not thrown on.
		expect(isValidZone('Mars/Olympus_Mons')).toBe(false);
		expect(isValidZone('')).toBe(false);
	});
});
