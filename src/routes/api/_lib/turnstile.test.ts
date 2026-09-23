import { describe, expect, it, vi } from 'vitest';
import { TURNSTILE_ACTION } from '$lib/shared-constants';
import { siteverify } from './turnstile';

/**
 * siteverify's three verdicts (doc 15 §3). The distinction that matters most is
 * between `fail` and `unavailable`: the first must never be softened, and the
 * second must never take the app down.
 */

const REAL_SECRET = '0x4AAAAAAA-real-looking-secret';
const HOST = 'tilepier.win';

function answering(body: unknown, status = 200) {
	return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
		Response.json(body, { status })
	);
}

async function verify(fetcher: typeof fetch, secret = REAL_SECRET) {
	return siteverify({ secret, token: 'tok', hostname: HOST, remoteip: '203.0.113.9', fetcher });
}

describe('siteverify', () => {
	it('passes a real token for this action and host', async () => {
		const fetcher = answering({ success: true, action: TURNSTILE_ACTION, hostname: HOST });
		expect(await verify(fetcher)).toEqual({ verdict: 'pass' });
	});

	it('sends the secret, the token, the address and an idempotency key as a form', async () => {
		const fetcher = answering({ success: true, action: TURNSTILE_ACTION, hostname: HOST });
		await verify(fetcher);

		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
		expect(init?.method).toBe('POST');
		const form = init?.body as FormData;
		expect(form.get('secret')).toBe(REAL_SECRET);
		expect(form.get('response')).toBe('tok');
		expect(form.get('remoteip')).toBe('203.0.113.9');
		expect(String(form.get('idempotency_key'))).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('fails a refused token, with the codes, and never softens it', async () => {
		const fetcher = answering({ success: false, 'error-codes': ['timeout-or-duplicate'] });
		expect(await verify(fetcher)).toEqual({ verdict: 'fail', codes: ['timeout-or-duplicate'] });
	});

	it('fails a token minted for another action', async () => {
		const fetcher = answering({ success: true, action: 'login', hostname: HOST });
		expect(await verify(fetcher)).toEqual({ verdict: 'fail', codes: ['action-mismatch'] });
	});

	it('fails a token minted on another host', async () => {
		const fetcher = answering({ success: true, action: TURNSTILE_ACTION, hostname: 'evil.test' });
		expect(await verify(fetcher)).toEqual({ verdict: 'fail', codes: ['hostname-mismatch'] });
	});

	it('does not check action or host for a testing secret, whose answers carry neither', async () => {
		const fetcher = answering({ success: true, action: '', hostname: 'example.com' });
		expect(await verify(fetcher, '1x0000000000000000000AA')).toEqual({ verdict: 'pass' });
	});

	it("still fails a testing secret's refusal", async () => {
		const fetcher = answering({ success: false, 'error-codes': ['invalid-input-response'] });
		expect((await verify(fetcher, '2x0000000000000000000AA')).verdict).toBe('fail');
	});

	it('calls internal-error, a 5xx, a timeout and HTML all unavailable', async () => {
		expect(
			(await verify(answering({ success: false, 'error-codes': ['internal-error'] }))).verdict
		).toBe('unavailable');
		expect((await verify(answering({}, 502))).verdict).toBe('unavailable');
		expect(
			(
				await verify(
					vi.fn(async () => {
						throw new DOMException('timed out', 'TimeoutError');
					})
				)
			).verdict
		).toBe('unavailable');
		expect((await verify(vi.fn(async () => new Response('<html>', { status: 200 })))).verdict).toBe(
			'unavailable'
		);
	});
});
