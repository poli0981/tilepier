import { describe, expect, it } from 'vitest';
import { newInstanceId } from './ids';

const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

describe('newInstanceId', () => {
	it('matches the shape doc 05 §2 documents', () => {
		expect(newInstanceId()).toMatch(/^wgt_[0-9a-z]{8}$/);
	});

	it('uses only the intended alphabet', () => {
		for (let i = 0; i < 500; i++) {
			for (const char of newInstanceId().slice(4)) {
				expect(ALPHABET, `unexpected character "${char}"`).toContain(char);
			}
		}
	});

	it('does not collide across ten thousand draws', () => {
		const seen = new Set<string>();
		for (let i = 0; i < 10_000; i++) seen.add(newInstanceId());

		expect(seen.size).toBe(10_000);
	});

	it('draws every character with roughly equal frequency', () => {
		// The point of a 32-character alphabet: 256 % 32 === 0, so `byte % 32`
		// is unbiased. A 62-character one favours its first 8 characters by
		// about 25 %, which no functional test would ever notice.
		const counts = new Map<string, number>();
		const draws = 4000;
		for (let i = 0; i < draws; i++) {
			for (const char of newInstanceId().slice(4)) {
				counts.set(char, (counts.get(char) ?? 0) + 1);
			}
		}

		expect(counts.size).toBe(ALPHABET.length);
		const expected = (draws * 8) / ALPHABET.length;
		for (const [char, count] of counts) {
			// Generous band: this is a bias check, not a randomness proof.
			expect(count, char).toBeGreaterThan(expected * 0.6);
			expect(count, char).toBeLessThan(expected * 1.4);
		}
	});
});
