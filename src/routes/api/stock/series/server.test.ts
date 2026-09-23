import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TpStockSeriesPayload } from '$lib/api-types';
import { cacheKey, STOCK_BUDGET } from '$lib/shared-constants';
import { GET } from './+server';

/**
 * `/api/stock/series` (doc 11 §3, §5): the one route that spends a budgeted
 * quota. Most of these cases are about *not* spending — an unknown symbol, an
 * unverifiable one, a guard at its tier, Twelve Data saying the credits are
 * gone — because each is a way a pass-holding script could drain the day.
 */

const TD_KEY = 'twelvedata-key-for-tests';
const FH_KEY = 'finnhub-key-for-tests';
const TODAY = () => new Date().toISOString().slice(0, 10);

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

interface Upstream {
	requests: { url: string; headers: Headers }[];
}

/** Routes by host: Finnhub answers quotes, Twelve Data answers series. */
function upstream(options: {
	series?: unknown;
	seriesStatus?: number;
	creditsLeft?: number;
	quote?: unknown;
}): Upstream {
	const requests: Upstream['requests'] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			requests.push({ url, headers: new Headers(init?.headers) });
			if (url.startsWith('https://finnhub.io/')) {
				return Response.json(options.quote ?? { c: 227.5, dp: 0.8, t: 1790175600 });
			}
			const headers: Record<string, string> = {};
			if (options.creditsLeft !== undefined)
				headers['api-credits-left'] = String(options.creditsLeft);
			if (options.seriesStatus !== undefined && options.seriesStatus >= 400) {
				return new Response('refused', { status: options.seriesStatus, headers });
			}
			return Response.json(options.series ?? bars(40), { headers });
		})
	);
	return { requests };
}

function bars(count: number) {
	return {
		values: Array.from({ length: count }, (_, i) => ({
			datetime: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
			open: '100',
			high: '101',
			low: '99',
			close: String(100 + i),
			volume: '1000'
		})),
		status: 'ok'
	};
}

function known(kv: ReturnType<typeof fakeKv>, symbol = 'AAPL'): void {
	kv.store.set(
		`kv:${cacheKey.stockQuote(symbol)}`,
		JSON.stringify({
			cachedAt: Date.now(),
			source: 'finnhub',
			payload: {
				symbol,
				price: 1,
				changeDay: null,
				high: null,
				low: null,
				open: null,
				prevClose: null,
				at: 0
			}
		})
	);
}

function spent(kv: ReturnType<typeof fakeKv>): number {
	return Number(kv.store.get(`kv:st:budget:${TODAY()}`) ?? '0');
}

async function call(
	kv: KVNamespace,
	search = '?symbol=AAPL&interval=1day&limit=22',
	env: { TWELVEDATA_KEY?: string; FINNHUB_KEY?: string } = {}
): Promise<{ response: Response; settled: Promise<unknown> }> {
	const url = new URL(`https://tilepier.win/api/stock/series${search}`);
	const pending: Promise<unknown>[] = [];
	const response = await (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			platform?: {
				env: { TILEPIER_CACHE: KVNamespace; TWELVEDATA_KEY?: string; FINNHUB_KEY?: string };
				ctx: { waitUntil: (p: Promise<unknown>) => void };
			};
		}) => Promise<Response>
	)({
		request: new Request(url),
		url,
		platform: {
			env: { TILEPIER_CACHE: kv, TWELVEDATA_KEY: TD_KEY, FINNHUB_KEY: FH_KEY, ...env },
			ctx: { waitUntil: (p) => void pending.push(p) }
		}
	});
	return { response, settled: Promise.all(pending) };
}

async function read(response: Response): Promise<{
	ok: boolean;
	data: TpStockSeriesPayload;
	meta: { stale: boolean };
	error?: { code: string };
}> {
	return (await response.json()) as never;
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

describe('a known symbol', () => {
	it('fetches one deep series with the key in a header, and answers a window of it', async () => {
		const kv = fakeKv();
		known(kv);
		const { requests } = upstream({ series: bars(40), creditsLeft: 799 });

		const { response, settled } = await call(kv);
		await settled;
		const { data } = await read(response);

		expect(response.status).toBe(200);
		expect(data.candles).toHaveLength(22);
		// The newest 22 of 40 — the last bar's close is 100 + 39.
		expect(data.candles.at(-1)?.[4]).toBe(139);

		const series = requests.find((r) => r.url.startsWith('https://api.twelvedata.com/'));
		expect(series?.headers.get('authorization')).toBe(`apikey ${TD_KEY}`);
		expect(series?.url).not.toContain(TD_KEY);
		expect(series?.url).toContain('timezone=UTC');
		expect(series?.url).toContain('outputsize=260');
		expect(spent(kv)).toBe(1);
	});

	it('folds api-credits-left in when it says more was spent than we counted', async () => {
		const kv = fakeKv();
		known(kv);
		upstream({ creditsLeft: 100 });

		const { settled } = await call(kv);
		await settled;

		expect(spent(kv)).toBe(STOCK_BUDGET.dailyCredits - 100);
	});

	it('answers a second range from the same cached series without spending again', async () => {
		const kv = fakeKv();
		known(kv);
		upstream({ series: bars(260) });

		await (
			await call(kv)
		).settled;
		const { response } = await call(kv, '?symbol=AAPL&interval=1day&limit=252');

		expect((await read(response)).data.candles).toHaveLength(252);
		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		expect(spent(kv)).toBe(1);
	});
});

describe('never spending on a symbol that cannot be charted', () => {
	it('answers an empty series for a symbol Finnhub does not quote, and spends nothing', async () => {
		const kv = fakeKv();
		kv.store.set(
			`kv:${cacheKey.stockQuote('NOPE')}`,
			JSON.stringify({ cachedAt: Date.now(), source: 'finnhub', payload: null })
		);
		const { requests } = upstream({});

		const { response } = await call(kv, '?symbol=NOPE&interval=1day&limit=22');

		expect((await read(response)).data.candles).toEqual([]);
		expect(requests).toHaveLength(0);
		expect(spent(kv)).toBe(0);
	});

	it('asks Finnhub first when no quote is cached, and spends only once it answers', async () => {
		const kv = fakeKv();
		const { requests } = upstream({ quote: { c: 227.5, t: 1790175600 } });

		const { settled } = await call(kv);
		await settled;

		expect(requests.map((r) => new URL(r.url).host)).toEqual(['finnhub.io', 'api.twelvedata.com']);
		expect(spent(kv)).toBe(1);
	});

	it('spends nothing when the symbol cannot be checked at all', async () => {
		const kv = fakeKv();
		const { requests } = upstream({});

		const { response } = await call(kv, undefined, { FINNHUB_KEY: '' });

		expect(response.status).toBe(503);
		expect(requests).toHaveLength(0);
	});

	it('caches a symbol Twelve Data does not cover as empty, without blaming the breaker', async () => {
		const kv = fakeKv();
		known(kv);
		upstream({ series: { code: 400, message: 'symbol not found', status: 'error' } });

		const { response, settled } = await call(kv);
		await settled;

		expect((await read(response)).data.candles).toEqual([]);
		expect(JSON.parse(kv.store.get('kv:brk:twelvedata') ?? '{"failures":0}').failures).toBe(0);
	});
});

describe('the budget guard (doc 11 §5)', () => {
	it('stops intraday at 720 while daily carries on', async () => {
		const kv = fakeKv();
		known(kv);
		kv.store.set(`kv:st:budget:${TODAY()}`, String(STOCK_BUDGET.intradayStopAt));
		const { requests } = upstream({});

		const intraday = await call(kv, '?symbol=AAPL&interval=15min&limit=26');
		expect(intraday.response.status).toBe(503);
		expect((await read(intraday.response)).error?.code).toBe('QUOTA_EXHAUSTED');
		expect(requests).toHaveLength(0);

		const daily = await call(kv);
		expect(daily.response.status).toBe(200);
	});

	it('stops daily at 780 and trips the breaker until UTC midnight', async () => {
		const kv = fakeKv();
		known(kv);
		kv.store.set(`kv:st:budget:${TODAY()}`, String(STOCK_BUDGET.dailySeriesStopAt));
		upstream({});

		const { response, settled } = await call(kv);
		await settled;

		expect((await read(response)).error?.code).toBe('QUOTA_EXHAUSTED');
		expect(JSON.parse(kv.store.get('kv:brk:twelvedata') ?? '{}')).toMatchObject({
			state: 'open',
			untilUtcMidnight: true
		});
	});

	it('trips the same way when Twelve Data says the credits are gone', async () => {
		const kv = fakeKv();
		known(kv);
		upstream({ seriesStatus: 429 });

		const { response } = await call(kv);

		expect((await read(response)).error?.code).toBe('QUOTA_EXHAUSTED');
		expect(JSON.parse(kv.store.get('kv:brk:twelvedata') ?? '{}').untilUtcMidnight).toBe(true);
	});
});

describe('refusals', () => {
	it('refuses a depth no range asks for, an unknown interval, and a bad symbol', async () => {
		const kv = fakeKv();
		for (const search of [
			'?symbol=AAPL&interval=1day&limit=23',
			'?symbol=AAPL&interval=1h&limit=22',
			'?symbol=%3Cscript%3E&interval=1day&limit=22'
		]) {
			expect((await call(kv, search)).response.status, search).toBe(400);
		}
	});

	it('does not call upstream without a Twelve Data key', async () => {
		const kv = fakeKv();
		known(kv);
		const { requests } = upstream({});

		const { response } = await call(kv, undefined, { TWELVEDATA_KEY: '' });

		expect(response.status).toBe(503);
		expect(requests).toHaveLength(0);
	});
});
