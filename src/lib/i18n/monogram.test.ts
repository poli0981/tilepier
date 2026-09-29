import { describe, expect, it } from 'vitest';
import { monogramOf } from './monogram';

describe('monogramOf', () => {
	it('shows a name by its first letter or digit, in the reader’s case', () => {
		expect(monogramOf('vnexpress.net', 'vi')).toBe('V');
		expect(monogramOf('«Đời sống»', 'vi')).toBe('Đ');
		expect(monogramOf('9to5Mac', 'en')).toBe('9');
		expect(monogramOf('ıstanbul', 'tr')).toBe('I');
		expect(monogramOf('— ', 'en')).toBe('#');
	});

	it('takes a whole character, not half of one', () => {
		// A title that starts with an astral-plane letter must not come back as a
		// lone surrogate.
		expect(monogramOf('𝒜 song', 'en')).toBe('𝒜');
	});
});
