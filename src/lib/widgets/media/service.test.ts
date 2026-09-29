import { describe, expect, it } from 'vitest';
import {
	lruVictims,
	readPrefs,
	readResume,
	RESUME_KEEP,
	shouldResume,
	SPEEDS,
	troubleOf
} from './service';

/** The media widget's pure parts (doc 09 §3, doc 17 §4a). */

describe('troubleOf', () => {
	it('reads a source the browser cannot play as unsupported, whatever the file is called', () => {
		expect(troubleOf(4)).toBe('unsupported');
	});

	it('gives a local file that failed to read or decode one more try', () => {
		expect(troubleOf(2)).toBe('retry');
		expect(troubleOf(3)).toBe('retry');
	});

	it('says nothing when a newer source took over, or when there is no error', () => {
		expect(troubleOf(1)).toBeNull();
		expect(troubleOf(undefined)).toBeNull();
	});
});

describe('SPEEDS', () => {
	it('runs from half speed to double, through normal (doc 09 §3)', () => {
		expect(SPEEDS[0]).toBe(0.5);
		expect(SPEEDS.at(-1)).toBe(2);
		expect(SPEEDS).toContain(1);
	});
});

describe('shouldResume', () => {
	it('comes back past the first five seconds, and not within the last five', () => {
		expect(shouldResume(5_001, 60_000)).toBe(true);
		expect(shouldResume(54_999, 60_000)).toBe(true);
		expect(shouldResume(5_000, 60_000)).toBe(false);
		expect(shouldResume(55_000, 60_000)).toBe(false);
		// A finished video was put back to the start.
		expect(shouldResume(0, 60_000)).toBe(false);
	});

	it('comes back to a place in a video whose length is not known', () => {
		expect(shouldResume(12_000, 0)).toBe(true);
		expect(shouldResume(Number.NaN, 60_000)).toBe(false);
	});
});

describe('readResume and readPrefs', () => {
	it('read back what was written', () => {
		const place = { name: 'Phim.mp4', size: 1234, positionMs: 61_000, durationMs: 90_000 };
		expect(readResume(place)).toEqual(place);
		expect(readPrefs({ volume: 0.4, muted: true })).toEqual({ volume: 0.4, muted: true });
	});

	it('fail closed on anything this build did not write', () => {
		expect(readResume(null)).toBeNull();
		expect(readResume({ name: 'a', size: 1, positionMs: -1, durationMs: 0 })).toBeNull();
		expect(readResume({ name: 7, size: 1, positionMs: 1, durationMs: 1 })).toBeNull();
		expect(readResume({ name: 'a', size: 1, positionMs: '1', durationMs: 1 })).toBeNull();
		expect(readPrefs({ volume: 2, muted: false })).toBeNull();
		expect(readPrefs({ volume: 0.5, muted: 'no' })).toBeNull();
		expect(readPrefs('loud')).toBeNull();
	});
});

describe('lruVictims', () => {
	it('names the rows past the newest few, whatever order they come in', () => {
		const rows = [
			{ id: 'b', updatedAt: 2 },
			{ id: 'd', updatedAt: 4 },
			{ id: 'a', updatedAt: 1 },
			{ id: 'c', updatedAt: 3 }
		];
		expect(lruVictims(rows, 2).sort()).toEqual(['a', 'b']);
		expect(lruVictims(rows, 4)).toEqual([]);
	});

	it('keeps twenty (doc 09 §3)', () => {
		expect(RESUME_KEEP).toBe(20);
	});
});
