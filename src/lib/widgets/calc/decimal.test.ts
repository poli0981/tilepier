import { describe, expect, it } from 'vitest';
import { fromString, toPlainString } from './decimal';

describe('fromString', () => {
	it.each([
		['0', '0'],
		['1.', '1'],
		['.5', '0.5'],
		['-0.25', '-0.25'],
		['  12.50 ', '12.5'],
		['-7', '-7']
	])('reads %j as %s', (text, plain) => {
		const value = fromString(text);
		expect(value).not.toBeNull();
		if (value !== null) expect(toPlainString(value)).toBe(plain);
	});

	it.each(['', '-', '.', '-.', '1.2.3', '1e5', '+1', '--1', '1 2', 'a'])('refuses %j', (text) => {
		expect(fromString(text)).toBeNull();
	});

	it('refuses a long run of digits that ends in a letter in linear time (SonarQube S8786)', () => {
		// `\d*\.?\d*` let both runs of digits claim the same characters: about two
		// seconds to say no to this.
		const start = performance.now();
		expect(fromString(`${'1'.repeat(100_000)}a`)).toBeNull();
		expect(performance.now() - start).toBeLessThan(250);
	});
});
