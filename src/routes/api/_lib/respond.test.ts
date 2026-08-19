import { describe, expect, it } from 'vitest';
import { fail, isCrossSite, ok } from './respond';

/** The envelope contract, doc 11 §2. A client that trusts these shapes is the
 *  whole reason `lib/api-types.ts` is shared by both sides. */

const META = { cachedAt: 1_700_000_000, source: 'open-meteo', stale: false };

describe('ok', () => {
	it('wraps the payload with its metadata', async () => {
		const response = ok({ t: 21 }, META, 'HIT', 600);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, data: { t: 21 }, meta: META });
	});

	it('reports the cache status in a header, for measurement under load', async () => {
		for (const status of ['HIT', 'MISS', 'STALE'] as const) {
			expect(ok({}, META, status, 600).headers.get('x-tp-cache')).toBe(status);
		}
	});

	it('caches at half the TTL, so the edge refreshes before the client does', () => {
		expect(ok({}, META, 'MISS', 600).headers.get('cache-control')).toBe('public, max-age=300');
	});

	it('floors a half-second TTL rather than emitting a fraction', () => {
		expect(ok({}, META, 'MISS', 1).headers.get('cache-control')).toBe('public, max-age=0');
	});
});

describe('fail', () => {
	it('maps each code to the status a client can act on', () => {
		// doc 11 §2: 400 is our bug or theirs, 429 means slow down, 503 means
		// try later — a widget branches on this, not on the message.
		expect(fail('BAD_REQUEST').status).toBe(400);
		expect(fail('RATE_LIMITED').status).toBe(429);
		expect(fail('QUOTA_EXHAUSTED').status).toBe(503);
		expect(fail('UPSTREAM_DOWN').status).toBe(503);
	});

	it('carries retry-after both in the envelope and as a header', async () => {
		const response = fail('RATE_LIMITED', 30);

		expect(response.headers.get('retry-after')).toBe('30');
		expect(await response.json()).toEqual({
			ok: false,
			error: { code: 'RATE_LIMITED', retryAfterS: 30 }
		});
	});

	it('omits retry-after entirely when there is no number to give', async () => {
		const response = fail('UPSTREAM_DOWN');

		expect(response.headers.get('retry-after')).toBeNull();
		expect(await response.json()).toEqual({ ok: false, error: { code: 'UPSTREAM_DOWN' } });
	});
});

describe('isCrossSite', () => {
	it('refuses only an explicit cross-site fetch', () => {
		const at = (site?: string) =>
			new Request('https://tilepier.win/api/weather', {
				headers: site === undefined ? {} : { 'sec-fetch-site': site }
			});

		expect(isCrossSite(at('cross-site'))).toBe(true);
		expect(isCrossSite(at('same-origin'))).toBe(false);
		expect(isCrossSite(at('none'))).toBe(false);
		// Absent by design in some clients; treating that as hostile would break
		// them for no security gain, since this is not an auth boundary.
		expect(isCrossSite(at())).toBe(false);
	});
});
