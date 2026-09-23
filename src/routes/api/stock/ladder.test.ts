import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKey } from '$lib/shared-constants';
import { GET as QUOTE } from './quote/+server';
import { GET as SERIES } from './series/+server';

/**
 * The stock half of doc 09 §1's degradation ladder, under fault injection —
 * the twin of `crypto/ladder.test.ts`. The endpoint suites prove each route's
 * rules; this proves what a reader sees when one upstream is down and the
 * other is not, which is the question the ladder actually answers:
 *
 *   Twelve Data out → stale candles with a badge → none: quote-only view
 *   (the quote route keeps answering, because the breakers are per upstream)
 *
 * Stooq's rung between the two was dropped on 2026-09-23 (doc 10 §5). Faults
 * go in through `fetch` and seeded KV only; the breaker itself is never mocked.
 */

type Handler = (event: {
	request: Request;
	url: URL;
	platform?: {
		env: Record<string, unknown>;
		ctx: { waitUntil: (p: Promise<unknown>) => void };
	};
}) => Promise<Response>;

const ENV = { TWELVEDATA_KEY: 'td', FINNHUB_KEY: 'fh' };
const QUOTE_OK = { c: 227.5, dp: 0.8, h: 228, l: 225, o: 226, pc: 225.7, t: 1790175600 };

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

async function call(handler: unknown, path: string, kv: KVNamespace): Promise<Response> {
	const url = new URL(`https://tilepier.win${path}`);
	const pending: Promise<unknown>[] = [];
	const response = await (handler as Handler)({
		request: new Request(url),
		url,
		platform: {
			env: { TILEPIER_CACHE: kv, ...ENV },
			ctx: { waitUntil: (p) => void pending.push(p) }
		}
	});
	await Promise.all(pending);
	return response;
}

/** Finnhub answers; Twelve Data does whatever the rung needs. */
function upstreams(twelveData: () => Response): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: RequestInfo | URL) =>
			String(input).startsWith('https://finnhub.io/') ? Response.json(QUOTE_OK) : twelveData()
		)
	);
}

function seedSeries(kv: ReturnType<typeof fakeKv>, ageMs: number): void {
	kv.store.set(
		`kv:${cacheKey.stockSeries('AAPL', '1day')}`,
		JSON.stringify({
			cachedAt: Date.now() - ageMs,
			source: 'twelvedata',
			payload: {
				symbol: 'AAPL',
				interval: '1day',
				candles: [[Date.UTC(2026, 8, 22), 1, 2, 0.5, 1.5, 10]],
				attribution: 'x'
			}
		})
	);
}

const SERIES_PATH = '/api/stock/series?symbol=AAPL&interval=1day&limit=22';
const QUOTE_PATH = '/api/stock/quote?symbols=AAPL';

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(Date.parse('2026-09-23T12:00:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('rung 1 — Twelve Data out of credits', () => {
	it('keeps the quote answering while the series is refused: the quote-only view', async () => {
		const kv = fakeKv();
		upstreams(() => new Response('out of credits', { status: 429 }));

		const series = await call(SERIES, SERIES_PATH, kv);
		const quote = await call(QUOTE, QUOTE_PATH, kv);

		expect(series.status).toBe(503);
		expect(((await series.json()) as { error: { code: string } }).error.code).toBe(
			'QUOTA_EXHAUSTED'
		);
		expect(quote.status).toBe(200);
	});

	it('serves the stale series, flagged, while the trip holds', async () => {
		const kv = fakeKv();
		seedSeries(kv, 7 * 60 * 60_000);
		upstreams(() => new Response('out of credits', { status: 429 }));

		const response = await call(SERIES, SERIES_PATH, kv);
		const body = (await response.json()) as { meta: { stale: boolean } };

		expect(response.status).toBe(200);
		expect(body.meta.stale).toBe(true);
	});
});

describe('rung 2 — the trip holds until UTC midnight, then probes', () => {
	it('spends nothing more today, and probes once the date turns', async () => {
		const kv = fakeKv();
		let seriesCalls = 0;
		upstreams(() => {
			seriesCalls++;
			return seriesCalls === 1
				? new Response('out of credits', { status: 429 })
				: Response.json({
						values: [{ datetime: '2026-09-23', open: '1', high: '2', low: '1', close: '2' }]
					});
		});

		await call(SERIES, SERIES_PATH, kv);
		vi.setSystemTime(Date.parse('2026-09-23T23:59:00Z'));
		await call(SERIES, SERIES_PATH, kv);
		expect(seriesCalls).toBe(1);

		vi.setSystemTime(Date.parse('2026-09-24T00:00:30Z'));
		const probe = await call(SERIES, SERIES_PATH, kv);
		expect(seriesCalls).toBe(2);
		expect(probe.status).toBe(200);
	});
});

describe('rung 3 — the breakers are per upstream', () => {
	it('keeps charting a known symbol while Finnhub is down', async () => {
		const kv = fakeKv();
		kv.store.set(
			`kv:${cacheKey.stockQuote('AAPL')}`,
			JSON.stringify({
				cachedAt: Date.now(),
				source: 'finnhub',
				payload: {
					symbol: 'AAPL',
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
		kv.store.set(
			'kv:brk:finnhub',
			JSON.stringify({ state: 'open', openedAt: Date.now(), reason: '503', failures: 3 })
		);
		upstreams(() =>
			Response.json({
				values: [{ datetime: '2026-09-22', open: '1', high: '2', low: '1', close: '2' }]
			})
		);

		const response = await call(SERIES, SERIES_PATH, kv);

		expect(response.status).toBe(200);
	});
});
