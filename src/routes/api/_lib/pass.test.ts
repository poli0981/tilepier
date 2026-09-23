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
		const { pass } = await issuePass(SECRET, NOW);
		const last = pass.at(-1) === 'A' ? 'B' : 'A';

		expect(await verifyPass(SECRET, pass.slice(0, -1) + last, NOW)).toBe(false);
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
