import { describe, expect, it } from 'vitest';
import { PASS_HEADER } from '$lib/shared-constants';
import { GATE_EXEMPT, gateState, guardApi } from './gate';
import { issuePass } from './pass';

/**
 * The gate as a table: who gets through, who gets a 401, and when there is no
 * gate at all. `hooks.server.ts` only calls this, so this is where the rules
 * are proved.
 */

const SECRET = 'turnstile-secret-for-tests';
const TOKEN = 'd'.repeat(40);
const ON = { TURNSTILE_SECRET_KEY: SECRET, TURNSTILE_SITE_KEY: 'sitekey', DEV_DASH_TOKEN: TOKEN };
const NOW = Date.parse('2026-09-23T12:00:00Z');

function request(headers: Record<string, string> = {}): Request {
	return new Request('https://tilepier.win/api/fx', { headers });
}

async function body(response: Response | null): Promise<unknown> {
	return response === null ? null : response.json();
}

describe('gateState', () => {
	it('is off without a secret, whatever the sitekey', () => {
		expect(gateState(undefined)).toBe('off');
		expect(gateState({ TURNSTILE_SITE_KEY: 'sitekey' })).toBe('off');
		expect(gateState({ TURNSTILE_SECRET_KEY: '', TURNSTILE_SITE_KEY: 'sitekey' })).toBe('off');
	});

	it('is misconfigured with a secret and no sitekey, and on with both', () => {
		expect(gateState({ TURNSTILE_SECRET_KEY: SECRET })).toBe('misconfigured');
		expect(gateState(ON)).toBe('on');
	});
});

describe('guardApi', () => {
	it('lets everything through when there is no gate', async () => {
		expect(await guardApi(request(), '/api/fx', {}, NOW)).toBeNull();
		expect(await guardApi(request(), '/api/fx', { TURNSTILE_SECRET_KEY: SECRET }, NOW)).toBeNull();
	});

	it('refuses a request with no pass, as 401 VERIFY_REQUIRED that nothing may store', async () => {
		const refusal = await guardApi(request(), '/api/fx', ON, NOW);

		expect(refusal?.status).toBe(401);
		expect(refusal?.headers.get('cache-control')).toBe('no-store');
		expect(await body(refusal)).toEqual({ ok: false, error: { code: 'VERIFY_REQUIRED' } });
	});

	it('lets a valid pass through, and refuses an expired or foreign one', async () => {
		const { pass } = await issuePass(SECRET, NOW);
		const foreign = (await issuePass('someone-else', NOW)).pass;

		expect(await guardApi(request({ [PASS_HEADER]: pass }), '/api/fx', ON, NOW)).toBeNull();
		expect(
			(await guardApi(request({ [PASS_HEADER]: pass }), '/api/fx', ON, NOW + 3_600_000))?.status
		).toBe(401);
		expect((await guardApi(request({ [PASS_HEADER]: foreign }), '/api/fx', ON, NOW))?.status).toBe(
			401
		);
	});

	it("lets the operator's bearer through without a pass", async () => {
		expect(
			await guardApi(request({ authorization: `Bearer ${TOKEN}` }), '/api/fx', ON, NOW)
		).toBeNull();
		expect(
			(await guardApi(request({ authorization: 'Bearer wrong' }), '/api/fx', ON, NOW))?.status
		).toBe(401);
	});

	it('never guards the route that issues passes, or the health report', async () => {
		for (const id of GATE_EXEMPT) {
			expect(await guardApi(request(), id, ON, NOW), id).toBeNull();
		}
		expect([...GATE_EXEMPT].sort()).toEqual(['/api/_health', '/api/verify']);
	});

	it('guards a path no route matched, so nothing unknown slips past', async () => {
		expect((await guardApi(request(), null, ON, NOW))?.status).toBe(401);
	});
});
