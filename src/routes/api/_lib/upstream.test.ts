import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UPSTREAM } from '$lib/shared-constants';
import { UpstreamError, fetchUpstream } from './upstream';

/**
 * The outbound half of the proxy (doc 11). Every guard here exists because the
 * Worker is calling third parties on a shared quota: a hung connection, an
 * unbounded body, or an HTML error page parsed as JSON all cost the same
 * budget as a real request.
 */

function response(body: string, init: ResponseInit = {}): Response {
	return new Response(body, init);
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('fetchUpstream', () => {
	it('parses JSON and hands back the headers', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response('{"ok":1}', { headers: { 'content-type': 'application/json', 'x-quota': '7' } })
			)
		);

		const result = await fetchUpstream<{ ok: number }>('https://example.test/x');

		expect(result.data).toEqual({ ok: 1 });
		expect(result.headers.get('x-quota')).toBe('7');
	});

	it('asks for gzip, because payloads are the cost here', async () => {
		let seen: RequestInit | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: unknown, init?: RequestInit) => {
				seen = init;
				return response('{}', { headers: { 'content-type': 'application/json' } });
			})
		);

		await fetchUpstream('https://example.test/x');

		// Payload size is the cost that matters on a shared quota, not requests.
		expect(new Headers(seen?.headers).get('accept-encoding')).toContain('gzip');
	});

	it('raises a typed error on a non-2xx, carrying status and headers', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response('nope', { status: 429, headers: { 'retry-after': '30' } }))
		);

		const error = await fetchUpstream('https://example.test/x').catch((e: unknown) => e);

		expect(error).toBeInstanceOf(UpstreamError);
		expect((error as UpstreamError).kind).toBe('status');
		expect((error as UpstreamError).status).toBe(429);
		// The breaker needs retry-after to respect the server's own number.
		expect((error as UpstreamError).headers?.get('retry-after')).toBe('30');
	});

	it('rejects a declared body over the cap before reading it', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response('{}', {
					headers: {
						'content-type': 'application/json',
						'content-length': String(UPSTREAM.maxResponseBytes + 1)
					}
				})
			)
		);

		const error = await fetchUpstream('https://example.test/x').catch((e: unknown) => e);

		expect((error as UpstreamError).kind).toBe('too-large');
	});

	it('classifies a network failure separately from a bad status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('failed to fetch');
			})
		);

		const error = await fetchUpstream('https://example.test/x').catch((e: unknown) => e);

		expect((error as UpstreamError).kind).toBe('network');
	});

	it('classifies an abort as a timeout, not a network error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				const error = new Error('aborted');
				error.name = 'AbortError';
				throw error;
			})
		);

		const error = await fetchUpstream('https://example.test/x').catch((e: unknown) => e);

		// They need different handling: a timeout trips the breaker, a DNS blip
		// does not necessarily mean the upstream is down.
		expect((error as UpstreamError).kind).toBe('timeout');
	});

	it('returns text when asked, without trying to parse it', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response('<rss></rss>'))
		);

		const result = await fetchUpstream<string>('https://example.test/feed', { parse: 'text' });

		expect(result.data).toBe('<rss></rss>');
	});

	it('wraps unparseable JSON, keeping a snippet of what arrived', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () =>
				response('<html>error</html>', { headers: { 'content-type': 'text/html' } })
			)
		);

		const error = await fetchUpstream('https://example.test/x').catch((e: unknown) => e);

		expect(error).toBeInstanceOf(UpstreamError);
		expect((error as UpstreamError).kind).toBe('malformed');
		// doc 17 §4 wants the snippet: it is the only thing that identifies which
		// upstream returned an HTML error page rather than JSON.
		expect((error as UpstreamError).message).toContain('<html>error</html>');
	});

	it('caps the snippet, so a megabyte of HTML does not become a log line', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response('<'.repeat(5000), { headers: { 'content-type': 'text/html' } }))
		);

		const error = await fetchUpstream('https://example.test/x').catch((e: unknown) => e);

		expect((error as UpstreamError).message.length).toBeLessThan(1100);
	});
});
