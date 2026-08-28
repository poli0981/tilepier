import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TpGeocodePayload } from '$lib/api-types';
import { cacheKey } from '$lib/shared-constants';
import { GET, normalizeQuery, parseQuery } from './+server';

/**
 * doc 11 §3's second endpoint, and the first with a **fallback chain**.
 *
 * Driven by calling the handler with stubs rather than through miniflare, the
 * same way `weather/server.test.ts` is: the branches that matter — validation,
 * the cache, Photon failing over to Nominatim, and Nominatim's mandatory
 * User-Agent — are all reachable without it.
 */

function fakeKv(): KVNamespace & { store: Map<string, string> } {
	const store = new Map<string, string>();
	return {
		store,
		get: (async (key: string, type?: string) => {
			const raw = store.get(key);
			if (raw == null) return null;
			return type === 'json' ? JSON.parse(raw) : raw;
		}) as KVNamespace['get'],
		put: async (key: string, value: string) => void store.set(key, String(value)),
		delete: async (key: string) => void store.delete(key),
		list: async () => ({ keys: [], list_complete: true }),
		getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null })
	} as unknown as KVNamespace & { store: Map<string, string> };
}

function call(
	options: { kv?: KVNamespace; search?: string; headers?: Record<string, string> } = {}
): Promise<Response> {
	const kv = options.kv ?? fakeKv();
	const url = new URL(`https://tilepier.win/api/geocode${options.search ?? '?q=Hà Nội&lang=vi'}`);
	const request = new Request(url, { headers: options.headers ?? {} });

	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			platform?: { env: { TILEPIER_CACHE: KVNamespace | undefined } };
		}) => Promise<Response>
	)({ request, url, platform: { env: { TILEPIER_CACHE: kv } } });
}

/** `response.json()` is `unknown` under `strict`, and every assertion below
 *  reaches into the envelope. One cast here beats six at the call sites. */
async function envelope(response: Response): Promise<{
	ok: boolean;
	data: TpGeocodePayload;
	meta: { source: string; stale: boolean };
	error?: { code: string };
}> {
	return (await response.json()) as {
		ok: boolean;
		data: TpGeocodePayload;
		meta: { source: string; stale: boolean };
		error?: { code: string };
	};
}

const PHOTON_BODY = {
	features: [
		{
			geometry: { coordinates: [105.8412, 21.0245] },
			properties: { name: 'Hà Nội', country: 'Việt Nam', osm_value: 'city' }
		}
	]
};

const NOMINATIM_BODY = [
	{
		lat: '21.0245',
		lon: '105.8412',
		display_name: 'Hà Nội, Việt Nam',
		name: 'Hà Nội',
		type: 'city'
	}
];

/** Answers the first host that matches, and records what it was asked. */
function stubFetch(routes: { photon?: unknown | Error; nominatim?: unknown | Error }) {
	const calls: { url: string; headers: Headers }[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, headers: new Headers(init?.headers) });

			const answer = url.includes('photon') ? routes.photon : routes.nominatim;
			if (answer === undefined) return new Response('nope', { status: 500 });
			if (answer instanceof Error) throw answer;
			return new Response(JSON.stringify(answer), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		})
	);
	return calls;
}

beforeEach(() => {
	vi.stubGlobal('crypto', globalThis.crypto);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('normalizeQuery', () => {
	it('collapses the differences that are not differences', () => {
		// One spelling per query, so three ways of typing the same search share
		// a cache entry instead of three (doc 04 §5).
		expect(normalizeQuery('  Hà   Nội ')).toBe('hà nội');
		expect(normalizeQuery('HÀ NỘI')).toBe('hà nội');
	});

	it('keeps diacritics, which are a real difference upstream', () => {
		// Folding them here would make two different searches share an answer.
		expect(normalizeQuery('Hà Nội')).not.toBe(normalizeQuery('Ha Noi'));
	});
});

describe('parseQuery', () => {
	const parse = (search: string) => parseQuery(new URL(`https://x/api/geocode${search}`));

	it('accepts a real query', () => {
		expect(parse('?q=Hà Nội&lang=vi')).toMatchObject({ q: 'Hà Nội', lang: 'vi' });
	});

	it('defaults the language to the base locale', () => {
		expect(parse('?q=Hanoi')?.lang).toBe('vi');
	});

	it('refuses a query that is too short or too long', () => {
		expect(parse('?q=a')).toBeNull();
		expect(parse(`?q=${'a'.repeat(200)}`)).toBeNull();
	});

	it('refuses a missing query rather than searching for nothing', () => {
		expect(parse('')).toBeNull();
		expect(parse('?lang=vi')).toBeNull();
	});

	it('refuses a language it does not have', () => {
		// A silent default would cache one language's answers under another's key.
		expect(parse('?q=Hanoi&lang=fr')).toBeNull();
	});
});

describe('the endpoint', () => {
	it('refuses a cross-site request', async () => {
		// doc 15 §3.2.
		const response = await call({ headers: { 'sec-fetch-site': 'cross-site' } });
		expect(response.status).toBe(403);
	});

	it('answers 400 for a query it will not run', async () => {
		const response = await call({ search: '?q=a' });
		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
	});

	it('normalizes Photon into the shared shape', async () => {
		stubFetch({ photon: PHOTON_BODY });
		const response = await call();

		expect(response.status).toBe(200);
		expect(response.headers.get('x-tp-cache')).toBe('MISS');
		const body = await envelope(response);
		expect(body.data.results[0]).toMatchObject({ name: 'Hà Nội', lat: 21.0245 });
		expect(body.data.attribution).toContain('OpenStreetMap');
	});

	it('serves a second identical search from KV', async () => {
		const kv = fakeKv();
		stubFetch({ photon: PHOTON_BODY });
		await call({ kv });

		const calls = stubFetch({ photon: PHOTON_BODY });
		const response = await call({ kv, search: '?q=  HÀ   NỘI  &lang=vi' });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		// The normalised key is why a differently-typed spelling still hits.
		expect(calls).toHaveLength(0);
		expect([...kv.store.keys()]).toContain(`kv:${cacheKey.geocode('vi', 'hà nội')}`);
	});

	it('caches a search that found nothing', async () => {
		// A search that found nothing is an answer. Re-asking two volunteer-run
		// services the same unanswerable question every keystroke is what their
		// fair-use policies are about (doc 10 §6).
		const kv = fakeKv();
		stubFetch({ photon: { features: [] } });
		const first = await call({ kv, search: '?q=zzzqqq&lang=vi' });
		expect((await envelope(first)).data.results).toEqual([]);

		const calls = stubFetch({ photon: PHOTON_BODY });
		const second = await call({ kv, search: '?q=zzzqqq&lang=vi' });
		expect(second.headers.get('x-tp-cache')).toBe('HIT');
		expect(calls).toHaveLength(0);
	});

	it('keys each language separately', async () => {
		const kv = fakeKv();
		stubFetch({ photon: PHOTON_BODY });
		await call({ kv, search: '?q=Hanoi&lang=vi' });

		const calls = stubFetch({ photon: PHOTON_BODY });
		await call({ kv, search: '?q=Hanoi&lang=en' });
		// A different language is a different question upstream.
		expect(calls.length).toBeGreaterThan(0);
	});
});

describe('the fallback chain (doc 10 §6)', () => {
	it('falls over to Nominatim when Photon fails', async () => {
		const calls = stubFetch({ photon: new Error('photon down'), nominatim: NOMINATIM_BODY });
		const response = await call();

		expect(response.status).toBe(200);
		const body = await envelope(response);
		expect(body.meta.source).toBe('nominatim');
		expect(body.data.results[0]).toMatchObject({ name: 'Hà Nội' });
		expect(calls.map((c) => c.url).join(' ')).toContain('nominatim');
	});

	it('does not ask Nominatim when Photon answered', async () => {
		// It only ever sees traffic Photon could not handle. That is the point
		// of the ordering, not an optimisation.
		const calls = stubFetch({ photon: PHOTON_BODY, nominatim: NOMINATIM_BODY });
		await call();

		expect(calls.filter((c) => c.url.includes('nominatim'))).toHaveLength(0);
	});

	it('sends the User-Agent Nominatim policy requires', async () => {
		// doc 10 §6: not optional. Nominatim blocks anonymous clients, and
		// rightly — it is a volunteer service.
		const calls = stubFetch({ photon: new Error('down'), nominatim: NOMINATIM_BODY });
		await call();

		const nominatim = calls.find((c) => c.url.includes('nominatim'));
		expect(nominatim?.headers.get('user-agent')).toContain('TilePier');
		expect(nominatim?.headers.get('user-agent')).toContain('tilepier.win');
	});

	it('serves a stale entry when both upstreams are down', async () => {
		// doc 11 §4: past the TTL, a cached value is served only when upstream
		// fails, and flagged so the client shows it for what it is.
		const kv = fakeKv();
		kv.store.set(
			`kv:${cacheKey.geocode('vi', 'hà nội')}`,
			JSON.stringify({
				cachedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
				source: 'photon',
				payload: { query: 'Hà Nội', results: [], attribution: 'x' }
			})
		);

		stubFetch({ photon: new Error('down'), nominatim: new Error('down') });
		const response = await call({ kv });

		expect(response.status).toBe(200);
		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect((await envelope(response)).meta.stale).toBe(true);
	});

	it('fails with an envelope when both are down and nothing is cached', async () => {
		stubFetch({ photon: new Error('down'), nominatim: new Error('down') });
		const response = await call();

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DOWN' } });
	});
});
