import { describe, expect, it } from 'vitest';
import {
	alphabetFor,
	clampLength,
	entropyBits,
	generatePassword,
	PASSWORD_DEFAULTS,
	PASSWORD_LIMITS,
	type TpPasswordOptions
} from './password';

/** doc 07 §7's password tab. */

const options = (overrides: Partial<TpPasswordOptions> = {}): TpPasswordOptions => ({
	...PASSWORD_DEFAULTS,
	...overrides
});

describe('alphabetFor', () => {
	it('includes exactly the classes that are switched on', () => {
		expect(alphabetFor(options({ lower: true, upper: false, digits: false, symbols: false }))).toBe(
			'abcdefghijklmnopqrstuvwxyz'
		);
		expect(alphabetFor(options({ lower: false, upper: false, digits: true, symbols: false }))).toBe(
			'0123456789'
		);
	});

	it('is empty when every class is off', () => {
		expect(
			alphabetFor(options({ lower: false, upper: false, digits: false, symbols: false }))
		).toBe('');
	});

	it('drops the look-alikes when asked, and only then', () => {
		const plain = alphabetFor(options({ noAmbiguous: false }));
		const filtered = alphabetFor(options({ noAmbiguous: true }));

		expect(plain).toContain('0');
		expect(plain).toContain('O');
		expect(filtered).not.toContain('0');
		expect(filtered).not.toContain('O');
		expect(filtered).not.toContain('l');
		expect(filtered).not.toContain('1');
		expect(filtered.length).toBeLessThan(plain.length);
	});

	it('leaves the unambiguous characters alone', () => {
		const filtered = alphabetFor(options({ noAmbiguous: true }));
		expect(filtered).toContain('a');
		expect(filtered).toContain('9');
		expect(filtered).toContain('#');
	});
});

describe('clampLength', () => {
	it('holds the range doc 07 §7 states', () => {
		expect(clampLength(4)).toBe(PASSWORD_LIMITS.min);
		expect(clampLength(200)).toBe(PASSWORD_LIMITS.max);
		expect(clampLength(24)).toBe(24);
	});

	it('rounds, and falls back rather than propagating a non-number', () => {
		// The value comes from an `<input type=number>`, which is empty as often
		// as it is numeric.
		expect(clampLength(20.6)).toBe(21);
		expect(clampLength(Number.NaN)).toBe(PASSWORD_DEFAULTS.length);
	});
});

describe('entropyBits', () => {
	it('is length × log2(alphabet), rounded', () => {
		// 26 lowercase letters is log2(26) ≈ 4.7 bits each.
		expect(
			entropyBits(options({ length: 10, lower: true, upper: false, digits: false, symbols: false }))
		).toBe(47);
		// The full set here is 26 + 26 + 10 + 27 = 89 characters.
		expect(alphabetFor(options())).toHaveLength(89);
		expect(entropyBits(options({ length: 20 }))).toBe(130);
	});

	it('is a property of the settings, not of any string', () => {
		// Which is why it can be shown before anything has been generated, and
		// why two passwords from the same settings have the same figure.
		expect(entropyBits(options({ length: 16 }))).toBe(entropyBits(options({ length: 16 })));
	});

	it('is zero when there is nothing to draw from', () => {
		expect(
			entropyBits(options({ lower: false, upper: false, digits: false, symbols: false }))
		).toBe(0);
	});

	it('falls when the look-alikes are dropped, because the alphabet shrinks', () => {
		expect(entropyBits(options({ noAmbiguous: true }))).toBeLessThan(entropyBits(options()));
	});
});

describe('generatePassword', () => {
	it('is the requested length', () => {
		for (const length of [8, 20, 64]) {
			expect(generatePassword(options({ length }))).toHaveLength(length);
		}
	});

	it('clamps a length outside the range rather than obeying it', () => {
		expect(generatePassword(options({ length: 1 }))).toHaveLength(PASSWORD_LIMITS.min);
		expect(generatePassword(options({ length: 500 }))).toHaveLength(PASSWORD_LIMITS.max);
	});

	it('draws only from the chosen alphabet', () => {
		const opts = options({ length: 64, lower: true, upper: false, digits: true, symbols: false });
		const allowed = new Set([...alphabetFor(opts)]);
		for (const character of generatePassword(opts)) {
			expect(allowed.has(character), character).toBe(true);
		}
	});

	it('never emits a look-alike when they are excluded', () => {
		const opts = options({ length: 64, noAmbiguous: true });
		// Sampled hard: at 64 characters a leaked `0` would show up quickly.
		for (let run = 0; run < 40; run++) {
			expect(generatePassword(opts)).not.toMatch(/[lI1O0oB8S5Z2G6|[\]{}]/);
		}
	});

	it('returns nothing when every class is off, rather than a weaker default', () => {
		// A silent fallback to lowercase would hand back a password weaker than
		// the settings on screen claim.
		expect(
			generatePassword(options({ lower: false, upper: false, digits: false, symbols: false }))
		).toBe('');
	});

	it('does not repeat itself', () => {
		const seen = new Set(Array.from({ length: 50 }, () => generatePassword(options())));
		expect(seen.size).toBe(50);
	});

	it('draws uniformly — the point of the rejection sampling', () => {
		// 89 characters does not divide 256, so `byte % 89` would favour the
		// first 78 of them by about 1.4×. This is the assertion that would fail
		// if the rejection step were ever dropped for "it is only a password".
		const opts = options({ length: 64 });
		const alphabet = alphabetFor(opts);
		expect(256 % alphabet.length).not.toBe(0);

		const counts = new Map<string, number>();
		const draws = 400;
		for (let run = 0; run < draws; run++) {
			for (const character of generatePassword(opts)) {
				counts.set(character, (counts.get(character) ?? 0) + 1);
			}
		}

		const total = draws * opts.length;
		const expected = total / alphabet.length;
		// The biased version separates the two halves of the alphabet by ~40%;
		// a 20% band is comfortably inside sampling noise at this many draws and
		// comfortably outside that bias.
		const head = [...alphabet].slice(0, 78).reduce((sum, c) => sum + (counts.get(c) ?? 0), 0) / 78;
		const tail = [...alphabet].slice(78).reduce((sum, c) => sum + (counts.get(c) ?? 0), 0) / 11;
		expect(Math.abs(head - expected) / expected).toBeLessThan(0.2);
		expect(Math.abs(tail - expected) / expected).toBeLessThan(0.2);
	});
});
