import { describe, expect, it } from 'vitest';
import { SPEEDS, troubleOf } from './service';

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
