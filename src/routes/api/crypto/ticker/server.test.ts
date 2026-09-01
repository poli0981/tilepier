import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TpCryptoTickerPayload } from '$lib/api-types';
import { cacheKey, symbolSetKey } from '$lib/shared-constants';
import { GET } from './+server';
import { parseCryptoTickerQuery } from '../../_lib/crypto-query';

/**
 * doc 11 §3's fourth endpoint, and the first for markets.
 *
 * Driven by calling the handler with stubs rather than through miniflare, the
 * way `weather`, `geocode` and `fx` are: every branch that matters —
 * validation, the cache, the breaker, and the per-symbol split — is reachable
 * without it.
 *
 * The helper is the **third copy** of `fx/server.test.ts`'s, and deliberately
 * that one rather than `geocode`'s older shape. Two things in it are load
 * bearing and both were paid for in Week 4b: `kv: null` spelled apart from an
 * omitted option, and a real `ctx.waitUntil` so the cache write can be awaited
 * instead of raced.
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

interface CallOptions {
	/**
	 * Omitted gives a working fake. **`null` means the binding is genuinely
	 * absent** — spelled apart from `undefined` because `undefined` is also what
	 * an omitted option looks like, and the two collapsing is why weather's
	 * missing-binding test passed for four weeks while never reaching the branch
	 * it names (doc 23 §Week 4b, fault 1).
	 */
	kv?: KVNamespace | null;
	search?: string;
	headers?: Record<string, string>;
}

interface CallResult {
	response: Response;
	/** Resolves once every `waitUntil` promise has settled — the cache write and
	 *  the breaker reset both ride on one (doc 11 §8). */
	settled: Promise<unknown>;
}

async function call(options: CallOptions = {}): Promise<CallResult> {
	const kv = options.kv === undefined ? fakeKv() : (options.kv ?? undefined);
	const url = new URL(
		`https://tilepier.win/api/crypto/ticker${options.search ?? '?symbols=BTCUSDT,ETHUSDT'}`
	);
	const request = new Request(url, { headers: options.headers ?? {} });
	const pending: Promise<unknown>[] = [];

	const response = await (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			platform?: {
				env: { TILEPIER_CACHE: KVNamespace | undefined };
				ctx: { waitUntil: (p: Promise<unknown>) => void };
			};
		}) => Promise<Response>
	)({
		request,
		url,
		platform: { env: { TILEPIER_CACHE: kv }, ctx: { waitUntil: (p) => void pending.push(p) } }
	});

	return { response, settled: Promise.all(pending) };
}

async function envelope(response: Response): Promise<{
	ok: boolean;
	data: TpCryptoTickerPayload;
	meta: { cachedAt: number; source: string; stale: boolean };
	error?: { code: string };
}> {
	return (await response.json()) as {
		ok: boolean;
		data: TpCryptoTickerPayload;
		meta: { cachedAt: number; source: string; stale: boolean };
		error?: { code: string };
	};
}

function row(symbol: string, price: string) {
	return {
		symbol,
		lastPrice: price,
		priceChangePercent: '1.5',
		highPrice: price,
		lowPrice: price,
		volume: '10',
		closeTime: 1_788_000_000_000
	};
}

/** The key the endpoint must build: canonical, so request order cannot move it. */
const KEY = `kv:${cacheKey.cryptoTicker(symbolSetKey(['BTCUSDT', 'ETHUSDT']))}`;

/** A *normalized* row, which is what the cache holds — `row()` above is the raw
 *  upstream shape, and seeding one of those would be seeding a lie. */
const CACHED_BTC = {
	symbol: 'BTCUSDT',
	price: 62_910.53,
	change24h: 0.015,
	high24h: 63_200,
	low24h: 61_200.45,
	volume24h: 18_422.19,
	at: 1_788_000_000_000
};

function seed(kv: KVNamespace & { store: Map<string, string> }, ageMs: number): void {
	const payload: TpCryptoTickerPayload = {
		// One real row and one absent one, so a seeded entry also exercises the
		// per-symbol `null` on the way back out of KV.
		quotes: { BTCUSDT: CACHED_BTC, ETHUSDT: null },
		attribution: 'Crypto data by Binance'
	};
	kv.store.set(KEY, JSON.stringify({ cachedAt: Date.now() - ageMs, source: 'binance', payload }));
}

/** A `Response` `fetchUpstream` will accept, or reject with the given status. */
function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

/** Fails every call, which is the default a test opts out of by re-stubbing. */
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

describe('parseCryptoTickerQuery', () => {
	const parse = (search: string) =>
		parseCryptoTickerQuery(new URL(`https://x/api/crypto/ticker${search}`));

	it('uppercases, and reports the canonical set beside the requested order', () => {
		expect(parse('?symbols=ethusdt,btcusdt')).toEqual({
			requested: ['ETHUSDT', 'BTCUSDT'],
			canonical: ['BTCUSDT', 'ETHUSDT']
		});
	});

	it('refuses a missing or empty list', () => {
		expect(parse('')).toBeNull();
		expect(parse('?symbols=')).toBeNull();
		expect(parse('?symbols=,,')).toBeNull();
	});

	it('refuses more than the cap rather than truncating to it', () => {
		const twelve = Array.from({ length: 12 }, (_, i) => `SYM${String(i)}`);
		expect(parse(`?symbols=${twelve.join(',')}`)).not.toBeNull();

		// Silently answering twelve of thirteen would cache a partial table under
		// a key that claims the whole set, and the thirteenth would then be
		// missing from every later read (the reasoning `fx-history-query.ts`
		// gives about clamping a range).
		expect(parse(`?symbols=${[...twelve, 'SYM12'].join(',')}`)).toBeNull();
	});

	it('refuses a symbol outside doc 10 §5, rather than dropping it', () => {
		expect(parse('?symbols=BTCUSDT,BTC/USDT')).toBeNull();
		expect(parse('?symbols=BTCUSDT,WAYTOOLONGSYMBOL')).toBeNull();
	});
});

describe('guards', () => {
	it('refuses a cross-site request outright', async () => {
		const { response } = await call({ headers: { 'sec-fetch-site': 'cross-site' } });

		expect(response.status).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('fails when the KV binding is missing', async () => {
		const { response } = await call({ kv: null });
		const body = await envelope(response);

		expect(response.status).toBe(503);
		expect(body.error?.code).toBe('UPSTREAM_DOWN');
	});

	it('rejects a bad symbol list before touching upstream', async () => {
		const { response } = await call({ search: '?symbols=BTC/USDT' });
		const body = await envelope(response);

		expect(response.status).toBe(400);
		expect(body.error?.code).toBe('BAD_REQUEST');
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('cache', () => {
	it('serves a fresh entry without calling upstream', async () => {
		const kv = fakeKv();
		seed(kv, 1000);

		const { response } = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		// doc 11 §2: half the 30 s family TTL.
		expect(response.headers.get('cache-control')).toBe('public, max-age=15');
		expect(fetch).not.toHaveBeenCalled();

		// The per-symbol shape survives the round trip through KV, which is the
		// half a status header cannot show.
		const body = await envelope(response);
		expect(body.data.quotes['BTCUSDT']?.price).toBe(CACHED_BTC.price);
		expect(body.data.quotes['ETHUSDT']).toBeNull();
	});

	it('keys on the canonical set, so request order cannot split the entry', async () => {
		const kv = fakeKv();
		seed(kv, 1000);

		// Asked the other way round; must still hit the entry seeded above.
		const { response } = await call({ kv, search: '?symbols=ETHUSDT,BTCUSDT' });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('fetches, normalizes and stores on a miss', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse([row('BTCUSDT', '62910.53'), row('ETHUSDT', '3241.09')]))
		);

		const kv = fakeKv();
		const { response, settled } = await call({ kv });
		await settled;
		const body = await envelope(response);

		expect(response.headers.get('x-tp-cache')).toBe('MISS');
		expect(body.data.quotes['BTCUSDT']?.price).toBe(62_910.53);
		expect(body.meta.source).toBe('binance');
		expect(kv.store.has(KEY)).toBe(true);
	});

	it('serves a stale entry when upstream is down, flagged as stale', async () => {
		const kv = fakeKv();
		// Past the 30 s TTL, inside the 10 min stale window.
		seed(kv, 60_000);

		const { response } = await call({ kv });
		const body = await envelope(response);

		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect(body.meta.stale).toBe(true);
	});

	it('is a 503 when upstream is down and nothing is cached', async () => {
		const { response } = await call();
		const body = await envelope(response);

		expect(response.status).toBe(503);
		expect(body.error?.code).toBe('UPSTREAM_DOWN');
	});

	it('refuses to cache an answer that names none of the symbols', async () => {
		// Binance replying 200 with a shape we cannot read is the crypto version
		// of ER-API replying 200 with no `rates`. Caching it would show a tile of
		// unavailable rows for the whole window with no error anywhere.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse([{ nonsense: true }]))
		);

		const kv = fakeKv();
		const { response, settled } = await call({ kv });
		await settled;

		expect(response.status).toBe(503);
		expect(kv.store.has(KEY)).toBe(false);
	});
});

/**
 * The part that is not in the spec and has to be, because
 * `/ticker/24hr?symbols=[...]` is all-or-nothing: one delisted coin 400s the
 * whole batch, and doc 09 §1's "delisted symbol → row error chip" is
 * unreachable without splitting.
 */
describe('the per-symbol split (doc 09 §1)', () => {
	it('answers for the good symbols when one of them is delisted', async () => {
		const fetchMock = vi.fn(async (input: string) => {
			const url = String(input);
			if (url.includes('symbols=')) {
				return jsonResponse({ code: -1121, msg: 'Invalid symbol.' }, 400);
			}
			if (url.includes('symbol=BTCUSDT')) return jsonResponse(row('BTCUSDT', '62910.53'));
			return jsonResponse({ code: -1121, msg: 'Invalid symbol.' }, 400);
		});
		vi.stubGlobal('fetch', fetchMock);

		const kv = fakeKv();
		const { response, settled } = await call({ kv, search: '?symbols=BTCUSDT,GONEUSDT' });
		await settled;
		const body = await envelope(response);

		expect(response.status).toBe(200);
		expect(body.data.quotes['BTCUSDT']?.price).toBe(62_910.53);
		expect(body.data.quotes['GONEUSDT']).toBeNull();
		// One batch, then one call per symbol.
		expect(fetchMock).toHaveBeenCalledTimes(3);

		// And the assembled answer caches, so the split costs three requests per
		// TTL rather than three per reader.
		const key = `kv:${cacheKey.cryptoTicker(symbolSetKey(['BTCUSDT', 'GONEUSDT']))}`;
		expect(kv.store.has(key)).toBe(true);
	});

	it('does not split a single-symbol batch', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ code: -1121 }, 400));
		vi.stubGlobal('fetch', fetchMock);

		const { response } = await call({ search: '?symbols=GONEUSDT' });

		// Nothing to learn from asking again: the one symbol is the bad one.
		expect(response.status).toBe(400);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('does not split a 429, and opens the breaker on the first one', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ msg: 'too many' }, 429));
		vi.stubGlobal('fetch', fetchMock);

		const kv = fakeKv();
		await call({ kv });

		// Multiplying one refused request into twelve is the exact shape doc 11
		// §6's breaker exists to prevent.
		expect(fetchMock).toHaveBeenCalledTimes(1);

		const record = JSON.parse(kv.store.get('kv:brk:binance') as string) as {
			state: string;
			failures: number;
		};
		// doc 10 §4: 429 and 418 open immediately rather than on the third.
		expect(record.state).toBe('open');
		expect(record.failures).toBe(1);
	});

	it('does not split a 5xx', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({ msg: 'boom' }, 503));
		vi.stubGlobal('fetch', fetchMock);

		await call();

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
