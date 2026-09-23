import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TpStockQuotePayload } from '$lib/api-types';
import { cacheKey } from '$lib/shared-constants';
import { GET } from './+server';

/**
 * `/api/stock/quote` (doc 11 §3): cached per symbol, fetched per symbol, one
 * payload per set. Driven by calling the handler with a fake KV and a stubbed
 * `fetch`, like the crypto routes. The cases that matter most are the per-row
 * ones: an unknown symbol is an answer, a failing one keeps its stale row, and
 * the key never appears in a URL.
 */

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

interface CallOptions {
	kv?: KVNamespace | null;
	search?: string;
	finnhubKey?: string;
	headers?: Record<string, string>;
}

async function call(
	options: CallOptions = {}
): Promise<{ response: Response; settled: Promise<unknown> }> {
	const kv = options.kv === undefined ? fakeKv() : (options.kv ?? undefined);
	const url = new URL(
		`https://tilepier.win/api/stock/quote${options.search ?? '?symbols=AAPL,MSFT'}`
	);
	const pending: Promise<unknown>[] = [];
	const response = await (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			platform?: {
				env: { TILEPIER_CACHE: KVNamespace | undefined; FINNHUB_KEY?: string };
				ctx: { waitUntil: (p: Promise<unknown>) => void };
			};
		}) => Promise<Response>
	)({
		request: new Request(url, { headers: options.headers ?? {} }),
		url,
		platform: {
			env: { TILEPIER_CACHE: kv, FINNHUB_KEY: options.finnhubKey ?? KEY },
			ctx: { waitUntil: (p) => void pending.push(p) }
		}
	});
	return { response, settled: Promise.all(pending) };
}

async function body(response: Response): Promise<{
	ok: boolean;
	data: TpStockQuotePayload;
	meta: { stale: boolean };
	error?: { code: string };
}> {
	return (await response.json()) as never;
}

function finnhub(answers: Record<string, unknown | number>) {
	const seen: { url: string; token: string | null }[] = [];
	const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		seen.push({ url: String(input), token: new Headers(init?.headers).get('x-finnhub-token') });
		const answer = answers[url.searchParams.get('symbol') ?? ''];
		if (typeof answer === 'number') return new Response('nope', { status: answer });
		return Response.json(answer ?? { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 });
	});
	vi.stubGlobal('fetch', fetcher);
	return seen;
}

const AAPL = { c: 227.5, d: 1.8, dp: 0.8, h: 228, l: 225, o: 226, pc: 225.7, t: 1790175600 };
const MSFT = { c: 431.2, d: -2.1, dp: -0.48, h: 434, l: 430, o: 433, pc: 433.3, t: 1790175600 };

function seed(
	kv: ReturnType<typeof fakeKv>,
	symbol: string,
	payload: unknown,
	ageMs: number
): void {
	kv.store.set(
		`kv:${cacheKey.stockQuote(symbol)}`,
		JSON.stringify({ cachedAt: Date.now() - ageMs, source: 'finnhub', payload })
	);
}

beforeEach(() => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => {
			throw new TypeError('no network in tests');
		})
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('GET /api/stock/quote', () => {
	it('fetches each missing symbol with the key in a header, never the URL', async () => {
		const seen = finnhub({ AAPL, MSFT });

		const { response } = await call();
		const { data } = await body(response);

		expect(response.status).toBe(200);
		expect(data.quotes['AAPL']?.price).toBe(227.5);
		expect(data.quotes['MSFT']?.changeDay).toBeCloseTo(-0.0048);
		expect(seen).toHaveLength(2);
		for (const call of seen) {
			expect(call.token).toBe(KEY);
			expect(call.url).not.toContain(KEY);
		}
	});

	it('answers from the cache per symbol, and only fetches what missed', async () => {
		const kv = fakeKv();
		seed(
			kv,
			'AAPL',
			{
				symbol: 'AAPL',
				price: 200,
				changeDay: 0,
				high: null,
				low: null,
				open: null,
				prevClose: null,
				at: 0
			},
			10_000
		);
		const seen = finnhub({ MSFT });

		const { response } = await call({ kv });
		const { data } = await body(response);

		expect(data.quotes['AAPL']?.price).toBe(200);
		expect(seen.map((s) => new URL(s.url).searchParams.get('symbol'))).toEqual(['MSFT']);
		expect(response.headers.get('x-tp-cache')).toBe('MISS');
	});

	it('is a HIT with no upstream call when every symbol is fresh', async () => {
		const kv = fakeKv();
		for (const symbol of ['AAPL', 'MSFT']) {
			seed(
				kv,
				symbol,
				{
					symbol,
					price: 1,
					changeDay: null,
					high: null,
					low: null,
					open: null,
					prevClose: null,
					at: 0
				},
				1000
			);
		}
		const seen = finnhub({});

		const { response } = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		expect(seen).toHaveLength(0);
	});

	it('answers an unknown symbol with a null row, caches it, and does not blame the breaker', async () => {
		const kv = fakeKv();
		finnhub({ AAPL });

		const { response, settled } = await call({ kv, search: '?symbols=AAPL,NOPE' });
		await settled;
		const { data } = await body(response);

		expect(data.quotes['NOPE']).toBeNull();
		expect(kv.store.has(`kv:${cacheKey.stockQuote('NOPE')}`)).toBe(true);
		expect(JSON.parse(kv.store.get('kv:brk:finnhub') ?? '{"failures":0}').failures).toBe(0);
	});

	it('keeps a failing symbol on its stale row, flagged stale', async () => {
		const kv = fakeKv();
		seed(
			kv,
			'MSFT',
			{
				symbol: 'MSFT',
				price: 400,
				changeDay: null,
				high: null,
				low: null,
				open: null,
				prevClose: null,
				at: 0
			},
			60 * 60_000
		);
		finnhub({ AAPL, MSFT: 502 });

		const { response } = await call({ kv });
		const result = await body(response);

		expect(result.data.quotes['AAPL']?.price).toBe(227.5);
		expect(result.data.quotes['MSFT']?.price).toBe(400);
		expect(result.meta.stale).toBe(true);
		expect(response.headers.get('x-tp-cache')).toBe('STALE');
	});

	it('is UPSTREAM_DOWN when nothing is cached and upstream fails, rather than a column of nulls', async () => {
		finnhub({ AAPL: 503, MSFT: 503 });
		const { response } = await call();
		expect(response.status).toBe(503);
		expect((await body(response)).error?.code).toBe('UPSTREAM_DOWN');
	});

	it('opens the breaker at once on a 429', async () => {
		const kv = fakeKv();
		finnhub({ AAPL: 429, MSFT });

		const { settled } = await call({ kv });
		await settled;

		expect(JSON.parse(kv.store.get('kv:brk:finnhub') ?? '{}').state).toBe('open');
	});

	it('does not call upstream at all without a key', async () => {
		const seen = finnhub({ AAPL, MSFT });
		const { response } = await call({ finnhubKey: '' });

		expect(response.status).toBe(503);
		expect(seen).toHaveLength(0);
	});

	it('refuses a cross-site request, a bad list, and a missing binding', async () => {
		expect((await call({ headers: { 'sec-fetch-site': 'cross-site' } })).response.status).toBe(403);
		expect((await call({ search: '?symbols=' })).response.status).toBe(400);
		expect((await call({ search: `?symbols=${'A,'.repeat(13)}A` })).response.status).toBe(400);
		expect((await call({ kv: null })).response.status).toBe(503);
	});
});
