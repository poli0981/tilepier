import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { lookup, store } from './edge-cache';
import { bind, settle } from './__fixtures__/workers';

/**
 * The edge cache adapter-cloudflare kept in front of SvelteKit until version 8,
 * kept to its rules (doc 11 §2). What matters most is what is *never* stored:
 * a refusal, an error, or a `no-store` answer such as `/api/_health`'s, which
 * would otherwise reach the next caller whatever they sent (`respond.ts`).
 */

const URL_FX = 'https://tilepier.win/api/fx';

/** `caches.default` as far as the module uses it, keyed by method and URL. */
function edge(): Map<string, Response> {
	const entries = new Map<string, Response>();
	vi.stubGlobal('caches', {
		default: {
			match: async (request: Request) => entries.get(`${request.method} ${request.url}`)?.clone(),
			put: async (request: Request, response: Response) =>
				void entries.set(`${request.method} ${request.url}`, response)
		}
	});
	return entries;
}

function cacheable(body: unknown = { ok: true }, headers: Record<string, string> = {}): Response {
	return Response.json(body, { headers: { 'cache-control': 'public, max-age=60', ...headers } });
}

beforeEach(() => {
	bind({});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('lookup', () => {
	it('finds nothing where there is no edge cache — tests, and prerendering', async () => {
		expect(await lookup(new Request(URL_FX))).toBeUndefined();
	});

	it('answers a GET from its entry, with headers the hook may still change', async () => {
		edge().set(`GET ${URL_FX}`, cacheable({ rate: 26_000 }));

		const hit = await lookup(new Request(URL_FX));

		expect(await hit?.json()).toEqual({ rate: 26_000 });
		hit?.headers.set('x-checked', 'yes');
		expect(hit?.headers.get('x-checked')).toBe('yes');
	});

	it('answers a HEAD from the GET entry, with no body', async () => {
		edge().set(`GET ${URL_FX}`, cacheable());

		const hit = await lookup(new Request(URL_FX, { method: 'HEAD' }));

		expect(hit?.status).toBe(200);
		expect(hit?.headers.get('cache-control')).toBe('public, max-age=60');
		expect(hit?.body).toBeNull();
	});

	it('is never asked by a request that says no-cache', async () => {
		edge().set(`GET ${URL_FX}`, cacheable());

		const request = new Request(URL_FX, { headers: { 'cache-control': 'no-cache' } });
		expect(await lookup(request)).toBeUndefined();
	});

	it('is never asked for any other method', async () => {
		const entries = edge();
		entries.set(`POST ${URL_FX}`, cacheable());

		expect(await lookup(new Request(URL_FX, { method: 'POST', body: '{}' }))).toBeUndefined();
	});

	it('finds nothing it was not given', async () => {
		edge();
		expect(await lookup(new Request(URL_FX))).toBeUndefined();
	});
});

describe('store', () => {
	it('keeps a GET whose answer says it may be kept, by way of waitUntil', async () => {
		const entries = edge();
		const response = cacheable();

		store(new Request(URL_FX), response);

		await expect(settle()).resolves.toHaveLength(1);
		expect(await entries.get(`GET ${URL_FX}`)?.json()).toEqual({ ok: true });
		// The reader's own copy is still unread.
		expect(response.bodyUsed).toBe(false);
	});

	it.each([
		['no cache-control at all', Response.json({ ok: true })],
		['no-store', cacheable({}, { 'cache-control': 'no-store' })],
		['private', cacheable({}, { 'cache-control': 'private, max-age=60' })],
		['no-cache', cacheable({}, { 'cache-control': 'public, no-cache' })],
		['Vary: *', cacheable({}, { vary: '*' })],
		['a cookie', cacheable({}, { 'set-cookie': 'a=b' })],
		[
			'a refusal',
			Response.json({ ok: false }, { status: 401, headers: { 'cache-control': 'max-age=60' } })
		],
		[
			'an error',
			Response.json({ ok: false }, { status: 503, headers: { 'cache-control': 'max-age=60' } })
		],
		[
			'a partial answer',
			new Response('x', { status: 206, headers: { 'cache-control': 'max-age=60' } })
		]
	])('never keeps an answer with %s', async (_, response) => {
		const entries = edge();

		store(new Request(URL_FX), response);
		await settle();

		expect(entries.size).toBe(0);
	});

	it('keeps nothing for a HEAD or a POST', async () => {
		const entries = edge();

		store(new Request(URL_FX, { method: 'HEAD' }), cacheable());
		store(new Request(URL_FX, { method: 'POST', body: '{}' }), cacheable());
		await settle();

		expect(entries.size).toBe(0);
	});

	it('does nothing where there is no edge cache', async () => {
		store(new Request(URL_FX), cacheable());

		await expect(settle()).resolves.toEqual([]);
	});

	it('lets a failed write pass, since the answer has already gone', async () => {
		vi.stubGlobal('caches', {
			default: { put: async () => Promise.reject(new Error('quota')) }
		});

		store(new Request(URL_FX), cacheable());

		await expect(settle()).resolves.toEqual([undefined]);
	});
});
