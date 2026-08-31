import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_POLICY, RATE_LIMIT, cacheKey } from '$lib/shared-constants';
import { ER_API_BODY, FX_PAYLOAD } from '$lib/core/__fixtures__/fx';
import { GET } from './+server';

/**
 * `/api/fx` — doc 11 §3, doc 10 §3.
 *
 * Same rig as `weather/server.test.ts`: the handler is called with stubs rather
 * than through miniflare, because every branch that matters is our own logic
 * layered on `get`/`put`.
 *
 * One addition. This endpoint's most interesting behaviour — the permanent
 * daily snapshot — happens inside `waitUntil`, so `call()` supplies a `ctx` that
 * collects what it is handed and gives back a promise to await. Without it the
 * snapshot assertions would be racing a floating promise, which is the kind of
 * test that passes locally and flakes in CI.
 */

/** 2026-08-31T10:00:00Z — well after ER-API's daily push at 00:02 that day. */
const NOW = Date.parse('2026-08-31T10:00:00Z');

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
	 * an omitted option looks like, and the two collapsing is why the
	 * missing-binding test passed for four weeks while never reaching the branch
	 * it names (found 2026-08-31).
	 */
	kv?: KVNamespace | null;
	headers?: Record<string, string>;
}

interface CallResult {
	response: Response;
	/** Resolves once every `waitUntil` promise has settled. */
	settled: Promise<unknown>;
}

async function call(options: CallOptions = {}): Promise<CallResult> {
	const kv = options.kv === undefined ? fakeKv() : (options.kv ?? undefined);
	const url = new URL('https://tilepier.win/api/fx');
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

/** Resolves every upstream call with one body. */
function stubUpstream(body: unknown = ER_API_BODY, status = 200): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => (status === 200 ? Response.json(body) : new Response('nope', { status })))
	);
}

function seedRates(kv: KVNamespace & { store: Map<string, string> }, ageMs: number): void {
	kv.store.set(
		`kv:${cacheKey.fx()}`,
		JSON.stringify({ cachedAt: NOW - ageMs, source: 'er-api', payload: FX_PAYLOAD })
	);
}

function seedSnapshot(
	kv: KVNamespace & { store: Map<string, string> },
	date: string,
	rates: Record<string, number>
): void {
	kv.store.set(
		`kv:${cacheKey.fxSnapshot(date)}`,
		JSON.stringify({
			cachedAt: Date.parse(`${date}T00:05:00Z`),
			source: 'er-api',
			payload: { rates }
		})
	);
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
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
	vi.useRealTimers();
});

describe('guards', () => {
	it('refuses a cross-site request', async () => {
		const { response } = await call({ headers: { 'sec-fetch-site': 'cross-site' } });
		expect(response.status).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('fails closed when the KV binding is missing', async () => {
		const { response } = await call({ kv: null });
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DOWN' } });
	});

	it('refuses past the rate limit', async () => {
		// The limiter buckets by address and deliberately allows a request that
		// carries none (doc 11 §7), so a test that wants to trip it has to look
		// like a caller rather than like nobody.
		const kv = fakeKv();
		const from = { headers: { 'cf-connecting-ip': '203.0.113.9' } };
		for (let i = 0; i < RATE_LIMIT.maxPerBucket; i++) await call({ kv, ...from });

		const { response } = await call({ kv, ...from });
		expect(response.status).toBe(429);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'RATE_LIMITED' } });
	});
});

describe('the cache', () => {
	it('serves a hit without touching upstream', async () => {
		const kv = fakeKv();
		seedRates(kv, 60_000);

		const { response } = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		expect(await response.json()).toMatchObject({ ok: true, meta: { stale: false } });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('advertises the family TTL when the next update is far off', async () => {
		stubUpstream();

		const { response, settled } = await call();
		await settled;

		// Upstream publishes again in ~14 h, past the 12 h in doc 11 §4's row, so
		// the cap is the longer of the two and changes nothing.
		expect(response.headers.get('cache-control')).toBe(
			`public, max-age=${CACHE_POLICY.fx.ttlMs / 2000}`
		);
	});

	it('advertises the capped window when upstream is about to publish', async () => {
		// 2026-08-31T20:00Z, with upstream's next push at 00:10:21 the next day —
		// 4 h 10 m 21 s away, plus doc 10 §3's five minutes of slack.
		vi.setSystemTime(Date.parse('2026-08-31T20:00:00Z'));
		stubUpstream();

		const { response, settled } = await call();
		await settled;

		expect(response.headers.get('cache-control')).toBe('public, max-age=7660');
	});

	it('serves a stale entry rather than nothing when upstream is down', async () => {
		const kv = fakeKv();
		seedRates(kv, CACHE_POLICY.fx.ttlMs + 60_000);

		const { response } = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect(await response.json()).toMatchObject({ ok: true, meta: { stale: true } });
	});

	it('fails when upstream is down and nothing was ever cached', async () => {
		const { response } = await call();
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DOWN' } });
	});
});

describe('the upstream path', () => {
	it('fetches, normalises and caches on a miss', async () => {
		stubUpstream();
		const kv = fakeKv();

		const { response, settled } = await call({ kv });
		await settled;

		expect(response.headers.get('x-tp-cache')).toBe('MISS');
		const body = (await response.json()) as {
			ok: boolean;
			data: { rates: Record<string, number>; attribution: string };
		};
		expect(body.ok).toBe(true);
		expect(body.data.rates['VND']).toBe(FX_PAYLOAD.rates['VND']);
		// doc 16 §5: the credit rides in the payload so a surface cannot render a
		// rate without also having been handed it.
		expect(body.data.attribution).toBeTruthy();
		expect(kv.store.has(`kv:${cacheKey.fx()}`)).toBe(true);
	});

	it('keeps only the rows it is willing to divide by', async () => {
		// Everything a rate table should never contain, in one object. The client
		// computes `rates[to] / rates[from]`, so a zero here is an Infinity on
		// somebody's tile rather than a visibly wrong number.
		stubUpstream({
			...ER_API_BODY,
			rates: { VND: 26_006, EUR: '0.86', GBP: -1, JPY: 0, KRW: null, EURO: 1.1, XYZ: 2 }
		});

		const { response, settled } = await call();
		await settled;

		const body = (await response.json()) as { data: { rates: Record<string, number> } };
		expect(body.data.rates).toEqual({ VND: 26_006, XYZ: 2, USD: 1 });
	});

	it('treats an answer with no usable rates as an upstream failure', async () => {
		// ER-API replies 200 with `result: "error"` and no `rates` key. Without a
		// guard the endpoint would cache an empty table for twelve hours and every
		// tile would show an em dash with no error anywhere.
		stubUpstream({ result: 'error', 'error-type': 'unsupported-code' });
		const kv = fakeKv();

		const { response, settled } = await call({ kv });
		await settled;

		expect(response.status).toBe(503);
		expect(kv.store.has(`kv:${cacheKey.fx()}`)).toBe(false);
	});

	it('opens the breaker immediately on a 429, not after three strikes', async () => {
		stubUpstream(null, 429);
		const kv = fakeKv();

		await call({ kv });

		const breaker = JSON.parse(kv.store.get('kv:brk:er-api') as string) as { state: string };
		expect(breaker.state).toBe('open');
	});

	it('does not touch upstream while the breaker is open', async () => {
		const kv = fakeKv();
		kv.store.set(
			'kv:brk:er-api',
			JSON.stringify({ state: 'open', openedAt: NOW, reason: '500', failures: 3 })
		);
		stubUpstream();

		const { response } = await call({ kv });

		expect(response.status).toBe(503);
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('the daily snapshot (doc 10 §3)', () => {
	it('writes the table permanently, under the day it was published', async () => {
		stubUpstream();
		const kv = fakeKv();

		const { settled } = await call({ kv });
		await settled;

		const key = `kv:${cacheKey.fxSnapshot('2026-08-31')}`;
		expect(kv.store.has(key)).toBe(true);
		const stored = JSON.parse(kv.store.get(key) as string) as { payload: { rates: object } };
		expect(stored.payload.rates).toEqual(FX_PAYLOAD.rates);
	});

	it('does not rewrite a day it has already recorded', async () => {
		stubUpstream();
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 1 });

		const { settled } = await call({ kv });
		await settled;

		const stored = JSON.parse(
			kv.store.get(`kv:${cacheKey.fxSnapshot('2026-08-31')}`) as string
		) as { payload: { rates: Record<string, number> } };
		// Still the seeded table — the write is skipped, not merged.
		expect(stored.payload.rates).toEqual({ USD: 1, VND: 1 });
	});

	it('keys the snapshot on the publication date, not on our clock', async () => {
		// The ten minutes between UTC midnight and ER-API's daily push. Keyed on
		// `now` this would file 31 August's table under 1 September — a wrong
		// number in a store that has no expiry and never gets rewritten.
		vi.setSystemTime(Date.parse('2026-09-01T00:05:00Z'));
		stubUpstream();
		const kv = fakeKv();

		const { settled } = await call({ kv });
		await settled;

		expect(kv.store.has(`kv:${cacheKey.fxSnapshot('2026-08-31')}`)).toBe(true);
		expect(kv.store.has(`kv:${cacheKey.fxSnapshot('2026-09-01')}`)).toBe(false);
	});
});

describe('yesterday, for doc 08 §2 24 h change', () => {
	it('carries the previous day rates when a snapshot exists', async () => {
		stubUpstream();
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-30', { USD: 1, VND: 25_951.2 });

		const { response, settled } = await call({ kv });
		await settled;

		const body = (await response.json()) as {
			data: { prevRates: Record<string, number> | null; prevDate: string | null };
		};
		expect(body.data.prevDate).toBe('2026-08-30');
		expect(body.data.prevRates?.['VND']).toBe(25_951.2);
	});

	it('reports nothing rather than zeros on day one', async () => {
		// The only shape the app can produce on the day it deploys: the snapshot
		// pile is empty, so the detail renders no change column at all.
		stubUpstream();

		const { response, settled } = await call();
		await settled;

		const body = (await response.json()) as {
			ok: boolean;
			data: { prevRates: unknown; prevDate: unknown };
		};
		expect(body.ok).toBe(true);
		expect(body.data.prevRates).toBeNull();
		expect(body.data.prevDate).toBeNull();
	});

	it('looks a day back from the publication, not from our clock', async () => {
		// Same midnight window as the snapshot test. Keyed on `now`, "yesterday"
		// would be 31 August — the very table in hand — and every row would show a
		// change of exactly zero, which reads as a calm market rather than a bug.
		vi.setSystemTime(Date.parse('2026-09-01T00:05:00Z'));
		stubUpstream();
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-30', { USD: 1, VND: 25_951.2 });
		seedSnapshot(kv, '2026-08-31', FX_PAYLOAD.rates);

		const { response, settled } = await call({ kv });
		await settled;

		const body = (await response.json()) as { data: { prevDate: string | null } };
		expect(body.data.prevDate).toBe('2026-08-30');
	});

	it('ignores a snapshot from an older build with nothing usable in it', async () => {
		// A KV value with no expiry outlives the code that wrote it, so by the
		// time it is read back it is somebody else's JSON like any other.
		stubUpstream();
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-30', {} as Record<string, number>);

		const { response, settled } = await call({ kv });
		await settled;

		const body = (await response.json()) as { data: { prevRates: unknown; prevDate: unknown } };
		expect(body.data.prevRates).toBeNull();
		expect(body.data.prevDate).toBeNull();
	});
});
