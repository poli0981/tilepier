import { describe, expect, it } from 'vitest';
import { isQrEcc, QR_ECC_LEVELS, QR_MAX_CHARS, qrMatrix } from './qr';

/**
 * doc 07 §7's QR tab.
 *
 * The split this file is written around: **the byte encoding is ours and the
 * matrix is the library's.** `qrcode-generator` is fifteen years old and widely
 * deployed, and without a decoder nothing here could verify its output anyway —
 * so what is asserted of it is shape, determinism and the version-selection
 * behaviour the UI depends on.
 *
 * The encoding is the opposite: it is an override we install, the library's
 * default would be wrong for most Vietnamese input, and it is checkable exactly
 * against `TextEncoder`.
 */

describe('the error-correction levels', () => {
	it('offers the four the standard defines, weakest first', () => {
		expect(QR_ECC_LEVELS).toEqual(['L', 'M', 'Q', 'H']);
	});

	it('guards a value read out of stored settings', () => {
		expect(isQrEcc('M')).toBe(true);
		expect(isQrEcc('X')).toBe(false);
		expect(isQrEcc(null)).toBe(false);
		expect(isQrEcc(2)).toBe(false);
	});
});

describe('qrMatrix', () => {
	it('produces a square matrix of a legal version size', () => {
		// Versions 1..40 are 21..177 modules, in steps of four.
		return qrMatrix('https://tilepier.win', 'M').then((matrix) => {
			expect(matrix).not.toBeNull();
			expect(matrix?.size).toBeGreaterThanOrEqual(21);
			expect(matrix?.size).toBeLessThanOrEqual(177);
			expect((matrix?.size ?? 0) % 4).toBe(1);
			expect(matrix?.modules).toHaveLength(matrix?.size ?? 0);
			for (const row of matrix?.modules ?? []) expect(row).toHaveLength(matrix?.size ?? 0);
		});
	});

	it('places the three finder patterns, which is the one thing a shape check can see', async () => {
		// A 7×7 finder sits in three corners of every QR ever made. If the matrix
		// came back transposed, empty or off by a row, this is what would say so.
		const matrix = await qrMatrix('tilepier', 'M');
		expect(matrix).not.toBeNull();
		const dark = (y: number, x: number): boolean => matrix?.modules[y]?.[x] === true;
		const size = matrix?.size ?? 0;

		for (const [oy, ox] of [
			[0, 0],
			[0, size - 7],
			[size - 7, 0]
		] as const) {
			// Outer ring dark, inner ring light, 3×3 core dark.
			expect(dark(oy, ox), `corner ${String(oy)},${String(ox)}`).toBe(true);
			expect(dark(oy + 1, ox + 1)).toBe(false);
			expect(dark(oy + 3, ox + 3)).toBe(true);
		}
		// And the fourth corner has no finder — that is how orientation is read.
		expect(dark(size - 7, size - 7)).toBe(false);
	});

	it('is deterministic for the same input', async () => {
		const a = await qrMatrix('chào bạn', 'M');
		const b = await qrMatrix('chào bạn', 'M');
		expect(a).toEqual(b);
	});

	it('encodes Vietnamese as UTF-8, not as truncated Latin-1', async () => {
		// The library's own `stringToBytes` is `charCodeAt(i) & 0xff`. Under it
		// `ộ` (U+1ED9) becomes byte 0xD9 and the scanned result is a different
		// character — for a Vietnamese-first app that is most inputs, not an edge
		// case. The override goes through the platform's UTF-8.
		const module = await import('qrcode-generator');
		const encoded = module.default.stringToBytes('Hà Nội');
		expect(encoded).toEqual([...new TextEncoder().encode('Hà Nội')]);
		// Nine bytes, not six: `à` and `ộ` are two and three bytes.
		expect(encoded).toHaveLength(9);
	});

	it('encodes an emoji, which is a surrogate pair and four bytes', async () => {
		await qrMatrix('x', 'M'); // ensure the override is installed
		const module = await import('qrcode-generator');
		expect(module.default.stringToBytes('🇻🇳')).toEqual([...new TextEncoder().encode('🇻🇳')]);
	});

	it('needs more modules for the same text at a stronger level', async () => {
		// Error correction costs capacity, so H cannot be smaller than L. Not
		// strictly larger for every input — short strings fit either way.
		const text = 'https://tilepier.win/w/calendar?i=wgt_abcdefgh';
		const low = await qrMatrix(text, 'L');
		const high = await qrMatrix(text, 'H');
		expect(high?.size).toBeGreaterThanOrEqual(low?.size ?? 0);
	});

	it('grows the version as the text grows', async () => {
		const small = await qrMatrix('a', 'M');
		const large = await qrMatrix('a'.repeat(400), 'M');
		expect(large?.size).toBeGreaterThan(small?.size ?? 0);
	});

	it('returns null for nothing, which is the empty state and not an error', async () => {
		expect(await qrMatrix('', 'M')).toBeNull();
	});

	it('returns null past the cap rather than throwing', async () => {
		// A paste of a whole document should produce a sentence, not an
		// exception. The cap sits well inside version 40's real capacity.
		expect(await qrMatrix('a'.repeat(QR_MAX_CHARS + 1), 'L')).toBeNull();
		expect(await qrMatrix('a'.repeat(QR_MAX_CHARS), 'L')).not.toBeNull();
	});

	it('returns null when the data does not fit even at the weakest level', async () => {
		// Under the character cap but over the byte capacity: 900 three-byte
		// characters is 2700 bytes, and level H holds far less.
		expect(await qrMatrix('ộ'.repeat(900), 'H')).toBeNull();
	});
});
