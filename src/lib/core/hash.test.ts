import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './hash';

/**
 * Golden: the stored ids are cut from this hash (music's track ids and cover
 * keys, media's resume keys), so it is checked against Node's own SHA-256
 * rather than against itself.
 */

function node(input: string | Uint8Array): string {
	return createHash('sha256').update(input).digest('hex');
}

const COMPOSED = 'Sơn Tùng/Chúng ta của hiện tại.mp3'.normalize('NFC');
const DECOMPOSED = COMPOSED.normalize('NFD');

describe('sha256Hex', () => {
	it('is SHA-256 in lowercase hex, all 32 bytes by default', async () => {
		expect(await sha256Hex('abc')).toBe(node('abc'));
		expect(await sha256Hex('abc')).toHaveLength(64);
	});

	it('cuts to the first bytes asked for — twelve for the stored ids', async () => {
		const key = `fsa|${COMPOSED}`;

		expect(await sha256Hex(key, 12)).toBe(node(key).slice(0, 24));
		expect(await sha256Hex(key, 12)).toHaveLength(24);
	});

	it('hashes text as UTF-8, so composed and decomposed Vietnamese differ', async () => {
		// Callers normalise to NFC first; this pins that the hash does not do it
		// for them, which would silently move every stored id.
		expect(await sha256Hex(DECOMPOSED, 12)).toBe(node(DECOMPOSED).slice(0, 24));
		expect(await sha256Hex(DECOMPOSED, 12)).not.toBe(await sha256Hex(COMPOSED, 12));
	});

	it('hashes a view of bytes by its own bytes, not its whole buffer', async () => {
		const whole = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
		const view = whole.subarray(2, 6);

		expect(await sha256Hex(view, 12)).toBe(node(Buffer.from([2, 3, 4, 5])).slice(0, 24));
	});
});
