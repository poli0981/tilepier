import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CRYPTO_RANGES, type TpCryptoKlinesPayload } from '$lib/api-types';
import { cacheKey } from '$lib/shared-constants';
import { GET } from './+server';
import { parseCryptoKlinesQuery } from '../../_lib/crypto-query';

/**
 * doc 11 §3's fifth endpoint.
 *
 * The case worth reading first is "windows a deep entry rather than caching one
 * per range": `cr:kl:v1:<sym>:<int>` has no depth in it, so without the window
 * two ranges silently overwrite each other and the payload shapes are identical
 * enough that nothing would notice.
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
	/** `null` means the binding is genuinely absent, apart from an omitted
	 *  option — doc 23 §Week 4b, fault 1. */
	kv?: KVNamespace | null;
	search?: string;
	headers?: Record<string, string>;
}

async function call(
	options: CallOptions = {}
): Promise<{ response: Response; settled: Promise<unknown> }> {
	const kv = options.kv === undefined ? fakeKv() : (options.kv ?? undefined);
	const url = new URL(
		`https://tilepier.win/api/crypto/klines${options.search ?? '?symbol=BTCUSDT&interval=5m&limit=288'}`
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
	data: TpCryptoKlinesPayload;
	meta: { cachedAt: number; source: string; stale: boolean };
	error?: { code: string };
}> {
	return (await response.json()) as {
		ok: boolean;
		data: TpCryptoKlinesPayload;
		meta: { cachedAt: number; source: string; stale: boolean };
		error?: { code: string };
	};
}

/** Binance's row shape: numeric timestamps, string OHLCV, five fields nothing
 *  reads. `count` rows, one minute apart, walking upwards. */
function upstreamRows(count: number): unknown[] {
	return Array.from({ length: count }, (_, i) => [
		1_788_000_000_000 + i * 60_000,
		String(100 + i),
		String(101 + i),
		String(99 + i),
		String(100.5 + i),
		'12.5',
		1_788_000_000_000 + i * 60_000 + 59_999,
		'1250',
		42,
		'6',
		'600',
		'0'
	]);
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
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

describe('parseCryptoKlinesQuery', () => {
	const parse = (search: string) =>
		parseCryptoKlinesQuery(new URL(`https://x/api/crypto/klines${search}`));

	it('accepts every depth the range set names, and nothing else', () => {
		for (const range of Object.values(CRYPTO_RANGES)) {
			const query = parse(
				`?symbol=BTCUSDT&interval=${range.interval}&limit=${String(range.limit)}`
			);
			expect(query?.limit).toBe(range.limit);
		}

		// A free integer would give 500 CDN entries per symbol-and-interval that
		// one client can walk with a loop (doc 11 §3's reasoning about `days`).
		expect(parse('?symbol=BTCUSDT&interval=5m&limit=287')).toBeNull();
		expect(parse('?symbol=BTCUSDT&interval=5m&limit=500')).toBeNull();
		expect(parse('?symbol=BTCUSDT&interval=5m&limit=0')).toBeNull();
	});

	it('refuses an interval outside doc 10 §4', () => {
		expect(parse('?symbol=BTCUSDT&interval=3m&limit=288')).toBeNull();
		expect(parse('?symbol=BTCUSDT&interval=&limit=288')).toBeNull();
		expect(parse('?symbol=BTCUSDT&limit=288')).toBeNull();
	});

	it('refuses a symbol outside doc 10 §5, and uppercases the ones it takes', () => {
		expect(parse('?symbol=BTC/USDT&interval=5m&limit=288')).toBeNull();
		expect(parse('?symbol=btcusdt&interval=5m&limit=288')?.symbol).toBe('BTCUSDT');
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

		expect(response.status).toBe(503);
		expect((await envelope(response)).error?.code).toBe('UPSTREAM_DOWN');
	});

	it('rejects a bad query before touching upstream', async () => {
		const { response } = await call({ search: '?symbol=BTCUSDT&interval=3m&limit=288' });

		expect(response.status).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('the deep entry and its window', () => {
	it('always asks upstream for the 500-candle maximum, whatever the limit', async () => {
		const fetchMock = vi.fn(async (input: string) => {
			const asked = Number(new URL(String(input)).searchParams.get('limit') ?? '0');
			return jsonResponse(upstreamRows(asked));
		});
		vi.stubGlobal('fetch', fetchMock);

		await call({ search: '?symbol=BTCUSDT&interval=1d&limit=30' });

		const asked = String(fetchMock.mock.calls[0]?.[0]);
		expect(asked).toContain('limit=500');
		expect(asked).toContain('symbol=BTCUSDT');
		expect(asked).toContain('interval=1d');
	});

	it('answers with the newest `limit` candles', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(upstreamRows(500)))
		);

		const { response } = await call({ search: '?symbol=BTCUSDT&interval=1d&limit=30' });
		const body = await envelope(response);

		expect(body.data.candles).toHaveLength(30);
		// The last row upstream sent, not the first — a range means the recent end.
		expect(body.data.candles.at(-1)?.[0]).toBe(1_788_000_000_000 + 499 * 60_000);
	});

	it('stores the deep series, so a wider range needs no second fetch', async () => {
		// The mock honours the `limit` it is asked for, which is what gives this
		// case teeth: a version that asked upstream for the *requested* depth
		// would store thirty candles and the wide range below would come back
		// thirty long, under a key that claims to answer for any range.
		const fetchMock = vi.fn(async (input: string) => {
			const asked = Number(new URL(String(input)).searchParams.get('limit') ?? '0');
			return jsonResponse(upstreamRows(asked));
		});
		vi.stubGlobal('fetch', fetchMock);

		const kv = fakeKv();
		const narrow = await call({ kv, search: '?symbol=BTCUSDT&interval=1d&limit=30' });
		await narrow.settled;

		const stored = JSON.parse(
			kv.store.get(`kv:${cacheKey.cryptoKlines('BTCUSDT', '1d')}`) as string
		) as { payload: TpCryptoKlinesPayload };
		expect(stored.payload.candles).toHaveLength(500);

		// The window is a property of the *response*, not of the entry — so the
		// wider range is a HIT rather than a second call. Without this the two
		// ranges would overwrite each other under one key, silently, because the
		// payload shapes are identical.
		const wide = await call({ kv, search: '?symbol=BTCUSDT&interval=1d&limit=365' });
		expect(wide.response.headers.get('x-tp-cache')).toBe('HIT');
		expect((await envelope(wide.response)).data.candles).toHaveLength(365);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('answers with everything it has when the series is shorter than the limit', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(upstreamRows(12)))
		);

		const { response } = await call({ search: '?symbol=BTCUSDT&interval=1d&limit=365' });

		// A coin listed last week has no year of history, and that is not an error.
		expect((await envelope(response)).data.candles).toHaveLength(12);
	});
});

describe('cache and failure', () => {
	it('splits the TTL at the hour, which is where doc 11 §4 now splits it', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse(upstreamRows(500)))
		);

		// 15m is the interval that used to fall between "5m int" and "1h+".
		const intraday = await call({ search: '?symbol=BTCUSDT&interval=15m&limit=288' });
		expect(intraday.response.headers.get('cache-control')).toBe('public, max-age=150');

		const daily = await call({ search: '?symbol=BTCUSDT&interval=1h&limit=168' });
		expect(daily.response.headers.get('cache-control')).toBe('public, max-age=450');
	});

	it('refuses to cache an empty series', async () => {
		// Binance answers 200 with `[]` for a symbol it knows nothing about.
		// Caching that draws an empty chart for the whole window with no error.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse([]))
		);

		const kv = fakeKv();
		const { response, settled } = await call({ kv });
		await settled;

		expect(response.status).toBe(503);
		expect(kv.store.has(`kv:${cacheKey.cryptoKlines('BTCUSDT', '5m')}`)).toBe(false);
		// The breaker record *is* written — an empty series counts as upstream
		// failing — so this checks the cache key rather than the store size.
		expect(kv.store.has('kv:brk:binance')).toBe(true);
	});

	it('serves a stale entry when upstream is down, still windowed', async () => {
		const kv = fakeKv();
		const payload: TpCryptoKlinesPayload = {
			symbol: 'BTCUSDT',
			interval: '1d',
			candles: Array.from({ length: 500 }, (_, i) => [i, 1, 2, 0.5, 1.5, 10] as const),
			attribution: 'Crypto data by Binance'
		};
		kv.store.set(
			`kv:${cacheKey.cryptoKlines('BTCUSDT', '1d')}`,
			// Past the 900 s TTL, inside the 6 h stale window.
			JSON.stringify({ cachedAt: Date.now() - 3_600_000, source: 'binance', payload })
		);

		const { response } = await call({ kv, search: '?symbol=BTCUSDT&interval=1d&limit=30' });
		const body = await envelope(response);

		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect(body.meta.stale).toBe(true);
		expect(body.data.candles).toHaveLength(30);
	});

	it('opens the breaker on the first 429', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => jsonResponse({ msg: 'too many' }, 429))
		);

		const kv = fakeKv();
		await call({ kv });

		const record = JSON.parse(kv.store.get('kv:brk:binance') as string) as { state: string };
		expect(record.state).toBe('open');
	});
});
