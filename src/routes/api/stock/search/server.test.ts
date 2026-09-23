import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TpStockSearchPayload } from '$lib/api-types';
import { cacheKey } from '$lib/shared-constants';
import { GET } from './+server';

/** `/api/stock/search` (doc 11 §3): the manager's search-add, cached a day. */

const KEY = 'finnhub-key-for-tests';

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

async function call(kv: KVNamespace, search: string): Promise<Response> {
	const url = new URL(`https://tilepier.win/api/stock/search${search}`);
	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			platform?: { env: { TILEPIER_CACHE: KVNamespace; FINNHUB_KEY?: string } };
		}) => Promise<Response>
	)({
		request: new Request(url),
		url,
		platform: { env: { TILEPIER_CACHE: kv, FINNHUB_KEY: KEY } }
	});
}

const RESULTS = {
	count: 2,
	result: [
		{ description: 'APPLE INC', displaySymbol: 'AAPL', symbol: 'AAPL', type: 'Common Stock' },
		{ description: 'APPLE HOSPITALITY REIT', symbol: 'APLE', type: 'REIT' }
	]
};

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('GET /api/stock/search', () => {
	it('asks Finnhub for US listings, with the key in a header, and keeps common stock', async () => {
		let seen: { url: string; token: string | null } | undefined;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				seen = { url: String(input), token: new Headers(init?.headers).get('x-finnhub-token') };
				return Response.json(RESULTS);
			})
		);

		const response = await call(fakeKv(), '?q=Apple');
		const body = (await response.json()) as { data: TpStockSearchPayload };

		expect(body.data.results).toEqual([{ symbol: 'AAPL', name: 'APPLE INC' }]);
		expect(seen?.token).toBe(KEY);
		expect(seen?.url).toContain('exchange=US');
		expect(seen?.url).not.toContain(KEY);
	});

	it('answers a repeated query from the cache, however it was capitalised', async () => {
		const kv = fakeKv();
		kv.store.set(
			`kv:${cacheKey.stockSearch('apple')}`,
			JSON.stringify({
				cachedAt: Date.now(),
				source: 'finnhub',
				payload: { query: 'apple', results: [], attribution: 'x' }
			})
		);
		const fetcher = vi.fn();
		vi.stubGlobal('fetch', fetcher);

		const response = await call(kv, '?q=APPLE');

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('refuses an empty, over-long or markup-shaped query rather than repairing it', async () => {
		for (const search of ['?q=', '?q=%20%20', `?q=${'a'.repeat(41)}`, '?q=%3Cscript%3E']) {
			expect((await call(fakeKv(), search)).status, search).toBe(400);
		}
	});
});
