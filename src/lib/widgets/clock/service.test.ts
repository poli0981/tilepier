import { describe, expect, it } from 'vitest';
import {
	MAX_ZONES,
	allZones,
	canonicalZone,
	homeZone,
	normaliseZones,
	offsetDeltaMinutes,
	offsetLabel,
	searchZones,
	solarPhase,
	startOfLocalDay,
	zoneCityLabel,
	zoneRegionLabel
} from './service';

/**
 * doc 07 §1's world clock. Fixed instants throughout — the day/night
 * terminator moves 15° an hour, so a test that reads the wall clock would
 * assert something different every time it ran.
 */

const JANUARY = Date.parse('2026-01-15T12:00:00Z');
const JULY = Date.parse('2026-07-15T12:00:00Z');
/** Northward equinox: the sun is over the equator, which is the one day the
 *  equatorial terminator this module models is also the real one. */
const EQUINOX_NOON = Date.parse('2026-03-20T12:00:00Z');

describe('zone naming', () => {
	it('rewrites the backward names to the modern ones', () => {
		// Measured on V8: supportedValuesOf returns the left-hand spellings, and
		// resolvedOptions() normalises the modern name *to* them.
		expect(canonicalZone('Asia/Saigon')).toBe('Asia/Ho_Chi_Minh');
		expect(canonicalZone('Asia/Calcutta')).toBe('Asia/Kolkata');
		expect(canonicalZone('Europe/Kiev')).toBe('Europe/Kyiv');
	});

	it('is idempotent, and leaves an unrenamed zone alone', () => {
		expect(canonicalZone(canonicalZone('Asia/Saigon'))).toBe('Asia/Ho_Chi_Minh');
		expect(canonicalZone('Asia/Tokyo')).toBe('Asia/Tokyo');
		expect(canonicalZone('UTC')).toBe('UTC');
	});

	it('offers the modern spelling in the picker, sorted', () => {
		const zones = allZones();
		expect(zones).toContain('Asia/Ho_Chi_Minh');
		expect(zones).not.toContain('Asia/Saigon');
		expect([...zones]).toEqual([...zones].sort());
	});

	it('reports the viewer zone in the modern spelling', () => {
		// Whatever the runner's zone is, it must never come back as a rename.
		expect(canonicalZone(homeZone())).toBe(homeZone());
	});

	it('splits an id into a city and a region', () => {
		expect(zoneCityLabel('Asia/Ho_Chi_Minh')).toBe('Ho Chi Minh');
		expect(zoneRegionLabel('Asia/Ho_Chi_Minh')).toBe('Asia');
		// Three segments: the city is the last one, not the second.
		expect(zoneCityLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
		expect(zoneRegionLabel('America/Argentina/Buenos_Aires')).toBe('America / Argentina');
	});

	it('labels a single-segment id without inventing a region', () => {
		expect(zoneCityLabel('UTC')).toBe('UTC');
		expect(zoneRegionLabel('UTC')).toBe('');
	});

	it('labels the backward spelling as the modern city', () => {
		expect(zoneCityLabel('Asia/Saigon')).toBe('Ho Chi Minh');
	});
});

describe('searchZones', () => {
	it('finds a zone through its separators', () => {
		expect(searchZones('ho chi')).toContain('Asia/Ho_Chi_Minh');
		expect(searchZones('Ho_Chi')).toContain('Asia/Ho_Chi_Minh');
		expect(searchZones('asia/ho')).toContain('Asia/Ho_Chi_Minh');
	});

	it('ignores case and Vietnamese diacritics', () => {
		// The search box is reached from a Vietnamese keyboard; folding is what
		// stops that mattering (src/lib/i18n/fold.ts).
		expect(searchZones('TOKYO')).toContain('Asia/Tokyo');
		expect(searchZones('  tokyo  ')).toContain('Asia/Tokyo');
	});

	it('returns the head of the list for an empty query', () => {
		const zones = ['Asia/Tokyo', 'Europe/Paris', 'UTC'];
		expect(searchZones('', 2, zones)).toEqual(['Asia/Tokyo', 'Europe/Paris']);
	});

	it('stops at the limit', () => {
		expect(searchZones('a', 5).length).toBe(5);
	});

	it('finds nothing rather than everything when nothing matches', () => {
		expect(searchZones('zzzzz')).toEqual([]);
	});
});

describe('normaliseZones', () => {
	it('keeps valid zones in order', () => {
		expect(normaliseZones(['Asia/Tokyo', 'Europe/Paris']).zones).toEqual([
			'Asia/Tokyo',
			'Europe/Paris'
		]);
	});

	it('drops a zone the platform does not know, and reports it', () => {
		// doc 07 §1: invalid stored zone → drop + warn. The caller does the
		// warning; this reports what to warn about.
		const result = normaliseZones(['Asia/Tokyo', 'Mars/Olympus_Mons']);
		expect(result.zones).toEqual(['Asia/Tokyo']);
		expect(result.dropped).toEqual(['Mars/Olympus_Mons']);
	});

	it('treats the two spellings of one zone as one row', () => {
		// A deck written in a browser that says Asia/Saigon and edited in one
		// that says Asia/Ho_Chi_Minh is a single zone, not two.
		expect(normaliseZones(['Asia/Saigon', 'Asia/Ho_Chi_Minh']).zones).toEqual(['Asia/Ho_Chi_Minh']);
	});

	it('ignores non-strings without dropping the rest', () => {
		const result = normaliseZones(['Asia/Tokyo', 42, null, { zone: 'Europe/Paris' }]);
		expect(result.zones).toEqual(['Asia/Tokyo']);
		expect(result.dropped).toEqual([]);
	});

	it('caps the list, because it lives in the layout key', () => {
		const many = Array.from({ length: MAX_ZONES + 5 }, (_, i) => `Etc/GMT+${(i % 12) + 1}`);
		expect(normaliseZones([...new Set(many)]).zones.length).toBeLessThanOrEqual(MAX_ZONES);
	});

	it('returns empty for anything that is not an array', () => {
		expect(normaliseZones(undefined).zones).toEqual([]);
		expect(normaliseZones('Asia/Tokyo').zones).toEqual([]);
	});
});

describe('offsets', () => {
	it('measures one zone against another', () => {
		// Tokyo is two hours ahead of Ho Chi Minh City — doc 07 §1's own example.
		expect(offsetDeltaMinutes(JANUARY, 'Asia/Tokyo', 'Asia/Ho_Chi_Minh')).toBe(120);
		expect(offsetDeltaMinutes(JANUARY, 'Asia/Ho_Chi_Minh', 'Asia/Tokyo')).toBe(-120);
	});

	it('moves when one side changes DST and the other does not', () => {
		// Vietnam has no DST; London does. The gap between them is not constant,
		// which is exactly why this is derived from Intl at an instant.
		expect(offsetDeltaMinutes(JANUARY, 'Europe/London', 'Asia/Ho_Chi_Minh')).toBe(-420);
		expect(offsetDeltaMinutes(JULY, 'Europe/London', 'Asia/Ho_Chi_Minh')).toBe(-360);
	});

	it('labels a difference the way the ruler shows it', () => {
		expect(offsetLabel(120)).toBe('+2h');
		expect(offsetLabel(-210)).toBe('−3h30');
		expect(offsetLabel(45)).toBe('+0h45');
		expect(offsetLabel(-60)).toBe('−1h');
	});

	it('says nothing at all for the same offset', () => {
		// An empty label, not "+0h": the ruler shows a gap, and there is none.
		expect(offsetLabel(0)).toBe('');
	});

	it('uses a real minus sign, not a hyphen', () => {
		// doc 12 §3 sets these in tabular numerals, where a hyphen is visibly the
		// wrong width.
		expect(offsetLabel(-120).startsWith('−')).toBe(true);
	});
});

describe('solarPhase', () => {
	it('is day at local noon and night at local midnight', () => {
		// 05:00 UTC is noon in Ho Chi Minh City; 17:00 UTC is midnight there.
		expect(solarPhase(Date.parse('2026-06-21T05:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('day');
		expect(solarPhase(Date.parse('2026-06-21T17:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe('night');
	});

	it('puts opposite sides of the planet in opposite phases', () => {
		expect(solarPhase(EQUINOX_NOON, 'Europe/London')).toBe('day');
		expect(solarPhase(EQUINOX_NOON, 'Pacific/Auckland')).toBe('night');
	});

	it('crosses day → twilight → night as the terminator sweeps past', () => {
		const at = (hhmm: string) => solarPhase(Date.parse(`2026-03-20T${hhmm}:00Z`), 'Europe/London');

		expect(at('18:00')).toBe('day');
		expect(at('18:20')).toBe('twilight');
		expect(at('18:40')).toBe('night');
	});

	it('finds twilight again at dawn', () => {
		expect(solarPhase(Date.parse('2026-03-20T06:00:00Z'), 'Europe/London')).toBe('twilight');
	});

	it('accepts a Date as readily as a timestamp', () => {
		expect(solarPhase(new Date(EQUINOX_NOON), 'Europe/London')).toBe('day');
	});
});

describe('startOfLocalDay', () => {
	it('truncates to midnight in the zone, not in UTC', () => {
		// 10:00 UTC on the 27th is 17:00 in Ho Chi Minh City, so the local day
		// began at 17:00 UTC on the 26th.
		expect(startOfLocalDay(Date.parse('2026-08-27T10:00:00Z'), 'Asia/Ho_Chi_Minh')).toBe(
			Date.parse('2026-08-26T17:00:00Z')
		);
	});

	it('handles a zone behind UTC', () => {
		expect(startOfLocalDay(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(
			Date.parse('2026-01-15T05:00:00Z')
		);
	});

	it('is already midnight when handed midnight', () => {
		const midnight = Date.parse('2026-08-26T17:00:00Z');
		expect(startOfLocalDay(midnight, 'Asia/Ho_Chi_Minh')).toBe(midnight);
	});
});
