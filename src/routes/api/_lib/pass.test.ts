import { describe, expect, it } from 'vitest';
import { DEGRADED_PASS_TTL_S, PASS_TTL_S, issuePass, verifyPass } from './pass';

/**
 * The pass is the whole of the gate's state, so every way to forge, stretch or
 * replay one across a secret gets a case. A pass is only ever as good as the
 * check that refuses a bad one.
 */

const SECRET = 'turnstile-secret-for-tests';
const NOW = Date.parse('2026-09-23T12:00:00Z');

describe('issuePass / verifyPass', () => {
	it('round-trips, and lives an hour', async () => {
		const { pass, expiresAt } = await issuePass(SECRET, NOW);

		expect(await verifyPass(SECRET, pass, NOW)).toBe(true);
		expect(expiresAt).toBe(NOW + PASS_TTL_S * 1000);
		expect(await verifyPass(SECRET, pass, NOW + PASS_TTL_S * 1000 - 1000)).toBe(true);
		expect(await verifyPass(SECRET, pass, NOW + PASS_TTL_S * 1000)).toBe(false);
	});

	it('marks a degraded pass and gives it ten minutes', async () => {
		const { pass, expiresAt } = await issuePass(SECRET, NOW, true);

		expect(pass.split('.')[3]).toBe('1');
		expect(expiresAt).toBe(NOW + DEGRADED_PASS_TTL_S * 1000);
		expect(await verifyPass(SECRET, pass, NOW + DEGRADED_PASS_TTL_S * 1000)).toBe(false);
	});

	it('refuses a pass made under another secret — which is what rotation does', async () => {
		const { pass } = await issuePass(SECRET, NOW);
		expect(await verifyPass('another-secret', pass, NOW)).toBe(false);
	});

	it('refuses a pass whose expiry was pushed out', async () => {
		const { pass } = await issuePass(SECRET, NOW);
		const [v, exp, nonce, d, mac] = pass.split('.');
		const stretched = [v, String(Number(exp) + 60), nonce, d, mac].join('.');

		expect(await verifyPass(SECRET, stretched, NOW)).toBe(false);
	});

	it('refuses a degraded pass relabelled as a normal one', async () => {
		const { pass } = await issuePass(SECRET, NOW, true);
		const [v, exp, nonce, , mac] = pass.split('.');

		expect(await verifyPass(SECRET, [v, exp, nonce, '0', mac].join('.'), NOW)).toBe(false);
	});

	it('refuses a signature that is almost right', async () => {
		// The MAC's *first* character, which is six bits of signature. This case
		// used to change the last one, and that was a flaky test with a real bug
		// behind it — see the next case.
		const { pass } = await issuePass(SECRET, NOW);
		const at = pass.lastIndexOf('.') + 1;
		const swapped = pass[at] === 'A' ? 'B' : 'A';

		expect(await verifyPass(SECRET, pass.slice(0, at) + swapped + pass.slice(at + 1), NOW)).toBe(
			false
		);
	});

	it('accepts every pass it issues — the one-spelling rule is not too strict', async () => {
		// The rule narrows the final character of two segments to the values an
		// encoder can write. A value missing from that list would refuse one real
		// pass in sixteen, which one round trip would catch one run in sixteen.
		// Three hundred make the chance of missing a class about one in 10⁸.
		for (let i = 0; i < 300; i++) {
			const { pass } = await issuePass(SECRET, NOW);
			expect(await verifyPass(SECRET, pass, NOW), pass).toBe(true);
		}
	});

	it('refuses a second spelling of the same signature', async () => {
		// A 32-byte MAC is 43 base64url characters, and the last one carries two
		// bits that encode nothing. `atob` discards them, so until 2026-09-23 a
		// pass with either bit set decoded to the same MAC and verified — four
		// spellings of every pass. Found because the case above flipped the last
		// character and went red whenever a MAC happened to end in `A` (one run
		// in sixteen): `A` to `B` sets exactly one of those bits.
		const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
		const { pass } = await issuePass(SECRET, NOW);
		const last = pass.at(-1) as string;
		const twin = ALPHABET[ALPHABET.indexOf(last) | 1] as string;

		expect(twin).not.toBe(last);
		expect(await verifyPass(SECRET, pass.slice(0, -1) + twin, NOW)).toBe(false);
	});

	it('refuses an expiry further out than any pass this build issues', async () => {
		// A validly signed pass from the future is a pass from a build with a
		// longer TTL, or a forgery — neither is one to honour.
		const { pass } = await issuePass(SECRET, NOW + 2 * PASS_TTL_S * 1000);
		expect(await verifyPass(SECRET, pass, NOW)).toBe(false);
	});

	it('refuses anything that is not the shape, before touching crypto', async () => {
		for (const junk of [
			'',
			'v1',
			'v2.1.2.0.3',
			'x'.repeat(4096),
			'v1.abc.AAAAAAAAAAAAAAAAAAAAAA.0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
		]) {
			expect(await verifyPass(SECRET, junk, NOW), JSON.stringify(junk.slice(0, 20))).toBe(false);
		}
	});

	it('issues passes that differ, even in the same second', async () => {
		const a = await issuePass(SECRET, NOW);
		const b = await issuePass(SECRET, NOW);
		expect(a.pass).not.toBe(b.pass);
	});
});
