import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BREAKER } from '$lib/shared-constants';
import { cacheKey } from '$lib/shared-constants';
import { GET as TICKER } from './ticker/+server';
import { GET as KLINES } from './klines/+server';

/**
 * doc 23's "degradation ladder verified by fault injection", crypto half.
 *
 * The endpoint suites beside this one check each route's own branches. This
 * file checks the **ladder** — what happens as an upstream gets worse, in the
 * order doc 11 §6 describes it — and it is a separate file because the rungs
 * are a property of the shared pipeline rather than of either route: both climb
 * the same one, and asserting it twice in two files is how the two would drift.
 *
 * Every rung below is reached by injecting the fault rather than by mocking the
 * breaker, so what is asserted is the behaviour a bad morning produces and not
 * a restatement of `breaker.ts`.
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

/**
 * The shape both handlers are *called* with, rather than either one's own
 * `RequestHandler`: SvelteKit parameterises that by route id, so the two are
 * structurally identical and nominally incompatible. Cast once here instead of
 * at every call site.
 */
type Handler = (event: {
	request: Request;
	url: URL;
	platform?: {
		env: { TILEPIER_CACHE: KVNamespace };
		ctx: { waitUntil: (p: Promise<unknown>) => void };
	};
}) => Promise<Response>;

const ticker = TICKER as unknown as Handler;
const klines = KLINES as unknown as Handler;

async function call(
	handler: Handler,
	path: string,
	kv: KVNamespace
): Promise<{ response: Response; settled: Promise<unknown> }> {
	const url = new URL(`https://tilepier.win${path}`);
	const request = new Request(url);
	const pending: Promise<unknown>[] = [];

	const response = await handler({
		request,
		url,
		platform: { env: { TILEPIER_CACHE: kv }, ctx: { waitUntil: (p) => void pending.push(p) } }
	});

	return { response, settled: Promise.all(pending) };
}

const TICKER_PATH = '/api/crypto/ticker?symbols=BTCUSDT';
const KLINES_PATH = '/api/crypto/klines?symbol=BTCUSDT&interval=1d&limit=30';

function ok(body: unknown): Response {
	return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
}

function status(code: number): Response {
	return new Response(JSON.stringify({ msg: 'no' }), {
		status: code,
		headers: { 'content-type': 'application/json' }
	});
}

const TICKER_ROW = {
	symbol: 'BTCUSDT',
	lastPrice: '62910.53',
	priceChangePercent: '1.5',
	highPrice: '63200',
	lowPrice: '61200',
	volume: '18422',
	closeTime: 1_788_000_000_000
};

/** A cached ticker payload, `ageMs` old. Rung 2 needs something to fall back to. */
function seedTicker(kv: KVNamespace & { store: Map<string, string> }, ageMs: number): void {
	kv.store.set(
		`kv:${cacheKey.cryptoTicker('BTCUSDT')}`,
		JSON.stringify({
			cachedAt: Date.now() - ageMs,
			source: 'binance',
			payload: {
				quotes: {
					BTCUSDT: {
						symbol: 'BTCUSDT',
						price: 1,
						change24h: 0,
						high24h: 1,
						low24h: 1,
						volume24h: 1,
						at: 1
					}
				},
				attribution: 'Crypto data by Binance'
			}
		})
	);
}

function breakerOf(kv: KVNamespace & { store: Map<string, string> }): {
	state: string;
	failures: number;
} {
	return JSON.parse(kv.store.get('kv:brk:binance') ?? '{}') as {
		state: string;
		failures: number;
	};
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

describe('rung 1 — upstream refuses us', () => {
	it('opens the breaker on the first 429 rather than on the third', async () => {
		const fetchMock = vi.fn(async () => status(429));
		vi.stubGlobal('fetch', fetchMock);
		const kv = fakeKv();

		await call(ticker, TICKER_PATH, kv);

		// doc 11 §6: any 429 or 418 is upstream telling us to stop, not a flaky
		// request. Waiting for three would spend two more refusals learning what
		// the first one said.
		expect(breakerOf(kv).state).toBe('open');
		expect(breakerOf(kv).failures).toBe(1);
	});

	it('opens on a 418 too, which is Binance for an IP ban', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => status(418))
		);
		const kv = fakeKv();

		await call(ticker, TICKER_PATH, kv);

		expect(breakerOf(kv).state).toBe('open');
	});

	it('does not report a refusal as a rate limit to the client', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => status(429))
		);
		const kv = fakeKv();

		const { response } = await call(ticker, TICKER_PATH, kv);
		const body = (await response.json()) as { error?: { code: string } };

		// The breaker's whole job is to absorb this: `RATE_LIMITED` on the client
		// means *our* soft limiter (doc 11 §7) and drives doc 17 §5's toast, which
		// a reader can do nothing about when it is Binance refusing the Worker.
		expect(body.error?.code).toBe('UPSTREAM_DOWN');
	});

	it('takes three consecutive 5xx to open, because those are flaky', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => status(503))
		);
		const kv = fakeKv();

		await call(ticker, TICKER_PATH, kv);
		expect(breakerOf(kv).state).toBe('closed');
		await call(ticker, TICKER_PATH, kv);
		expect(breakerOf(kv).state).toBe('closed');
		await call(ticker, TICKER_PATH, kv);

		expect(breakerOf(kv).state).toBe('open');
		expect(breakerOf(kv).failures).toBe(BREAKER.failureThreshold);
	});
});

describe('rung 2 — the breaker is open', () => {
	it('serves the stale entry without touching upstream at all', async () => {
		const fetchMock = vi.fn(async () => ok([TICKER_ROW]));
		vi.stubGlobal('fetch', fetchMock);

		const kv = fakeKv();
		// Past the 30 s TTL, inside the 10 min stale window.
		seedTicker(kv, 60_000);
		kv.store.set(
			'kv:brk:binance',
			JSON.stringify({ state: 'open', openedAt: Date.now(), reason: '429', failures: 1 })
		);

		const { response } = await call(ticker, TICKER_PATH, kv);
		const body = (await response.json()) as { meta: { stale: boolean } };

		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect(body.meta.stale).toBe(true);
		// The point of the rung: bulk back-off. An open breaker that still called
		// upstream would be a slower way of doing the thing upstream refused.
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('is a 503 rather than a hang when there is nothing cached', async () => {
		const fetchMock = vi.fn(async () => ok([TICKER_ROW]));
		vi.stubGlobal('fetch', fetchMock);

		const kv = fakeKv();
		kv.store.set(
			'kv:brk:binance',
			JSON.stringify({ state: 'open', openedAt: Date.now(), reason: '429', failures: 1 })
		);

		const { response } = await call(ticker, TICKER_PATH, kv);

		// doc 09 §1: "Never a spinner that hangs." The client turns this into an
		// inline error with a retry (doc 17 §4), which is a state the tile has.
		expect(response.status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('applies to both routes, because the breaker is per upstream', async () => {
		const fetchMock = vi.fn(async () => ok([]));
		vi.stubGlobal('fetch', fetchMock);

		const kv = fakeKv();
		kv.store.set(
			'kv:brk:binance',
			JSON.stringify({ state: 'open', openedAt: Date.now(), reason: '429', failures: 1 })
		);

		// One bad morning at Binance is one breaker, not one per route — which is
		// what keeps a watchlist tile and an open detail from each finding out
		// the hard way.
		const { response } = await call(klines, KLINES_PATH, kv);

		expect(response.status).toBe(503);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('rung 3 — the cool-down passes', () => {
	it('probes once and closes the breaker when upstream answers', async () => {
		const fetchMock = vi.fn(async () => ok([TICKER_ROW]));
		vi.stubGlobal('fetch', fetchMock);

		const kv = fakeKv();
		kv.store.set(
			'kv:brk:binance',
			JSON.stringify({
				state: 'open',
				// Opened longer ago than the cool-down, so the next request is the
				// half-open probe (doc 11 §6).
				openedAt: Date.now() - BREAKER.cooldownMs - 1000,
				reason: '429',
				failures: 1
			})
		);

		const { response, settled } = await call(ticker, TICKER_PATH, kv);
		await settled;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(response.headers.get('x-tp-cache')).toBe('MISS');
		expect(breakerOf(kv).state).toBe('closed');
		expect(breakerOf(kv).failures).toBe(0);
	});

	it('re-opens on a probe that fails, rather than counting up to three again', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => status(429))
		);

		const kv = fakeKv();
		kv.store.set(
			'kv:brk:binance',
			JSON.stringify({
				state: 'open',
				openedAt: Date.now() - BREAKER.cooldownMs - 1000,
				reason: '429',
				failures: 1
			})
		);

		await call(ticker, TICKER_PATH, kv);

		expect(breakerOf(kv).state).toBe('open');
	});
});

describe('rung 4 — upstream answers, but not usefully', () => {
	it('refuses to cache a ticker naming none of the symbols', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ok([{ nothing: true }]))
		);
		const kv = fakeKv();

		const { response, settled } = await call(ticker, TICKER_PATH, kv);
		await settled;

		// A 200 that cannot be read is the crypto version of ER-API replying 200
		// with no `rates`. Caching it shows a tile of unavailable rows for the
		// whole window with no error anywhere to explain them.
		expect(response.status).toBe(503);
		expect(kv.store.has(`kv:${cacheKey.cryptoTicker('BTCUSDT')}`)).toBe(false);
	});

	it('refuses to cache an empty candle series', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ok([]))
		);
		const kv = fakeKv();

		const { response, settled } = await call(klines, KLINES_PATH, kv);
		await settled;

		expect(response.status).toBe(503);
		expect(kv.store.has(`kv:${cacheKey.cryptoKlines('BTCUSDT', '1d')}`)).toBe(false);
	});

	it('counts an unreadable answer as a failure, so the ladder still climbs', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ok([{ nothing: true }]))
		);
		const kv = fakeKv();

		await call(ticker, TICKER_PATH, kv);
		await call(ticker, TICKER_PATH, kv);
		await call(ticker, TICKER_PATH, kv);

		// Otherwise an upstream answering 200-with-nonsense forever would be
		// fetched on every single request, which is the load the breaker exists
		// to shed.
		expect(breakerOf(kv).state).toBe('open');
	});
});

describe('rung 5 — the network is simply gone', () => {
	it('serves what is cached and says it is stale', async () => {
		const kv = fakeKv();
		seedTicker(kv, 60_000);

		// The default stub throws a `TypeError`, which is what a dead uplink looks
		// like from inside the Worker.
		const { response } = await call(ticker, TICKER_PATH, kv);
		const body = (await response.json()) as { meta: { stale: boolean } };

		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect(body.meta.stale).toBe(true);
	});

	it('will not serve an entry past its stale window', async () => {
		const kv = fakeKv();
		// 30 s TTL + 10 min stale window, and this is well past both.
		seedTicker(kv, 60 * 60_000);

		const { response } = await call(ticker, TICKER_PATH, kv);

		// doc 11 §4's window is a promise about how old a reading may be before
		// it stops being one. An hour-old price is not a price.
		expect(response.status).toBe(503);
	});
});
