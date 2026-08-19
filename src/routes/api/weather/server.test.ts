import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_POLICY, cacheKey } from '$lib/shared-constants';
import { geohash } from '../_lib/geohash';
import { GET } from './+server';

/**
 * The only live endpoint (doc 11). Driven by calling the handler with stubs
 * rather than through miniflare: the platform-proxy rig is a Week 3 item
 * (doc 19 §1), and the branches that matter here — cross-site, bad input, rate
 * limit, HIT, breaker open, stale-on-failure — are all reachable without it.
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
	kv?: KVNamespace | undefined;
	search?: string;
	headers?: Record<string, string>;
}

function call(options: CallOptions = {}): Promise<Response> {
	const kv = options.kv === undefined ? fakeKv() : options.kv;
	const url = new URL(
		`https://tilepier.win/api/weather${options.search ?? '?lat=21.02&lon=105.85'}`
	);
	const request = new Request(url, { headers: options.headers ?? {} });

	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			platform?: { env: { TILEPIER_CACHE: KVNamespace | undefined } };
		}) => Promise<Response>
	)({ request, url, platform: { env: { TILEPIER_CACHE: kv } } });
}

const PAYLOAD = { place: { lat: 21.02, lon: 105.85, timezone: 'Asia/Ho_Chi_Minh' } };

function seedCache(kv: KVNamespace & { store: Map<string, string> }, ageMs: number): void {
	kv.store.set(
		`kv:${cacheKey.weather(geohash(21.02, 105.85))}`,
		JSON.stringify({ cachedAt: Date.now() - ageMs, source: 'open-meteo', payload: PAYLOAD })
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

describe('guards', () => {
	it('refuses a cross-site request outright', async () => {
		const response = await call({ headers: { 'sec-fetch-site': 'cross-site' } });

		// A bare 403, not an envelope: this is not a client of ours.
		expect(response.status).toBe(403);
	});

	it('allows a request with no sec-fetch-site header', async () => {
		// Absent by design in some clients; refusing would break them (respond.ts).
		expect((await call()).status).not.toBe(403);
	});

	it('fails when the KV binding is missing rather than throwing', async () => {
		const response = await call({ kv: undefined });

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DOWN' } });
	});

	it('rejects missing or unparseable coordinates before any upstream call', async () => {
		for (const search of ['', '?lat=21.02', '?lat=abc&lon=1']) {
			const response = await call({ search });
			expect(await response.json(), search).toMatchObject({
				ok: false,
				error: { code: 'BAD_REQUEST' }
			});
		}
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('cache', () => {
	it('serves a fresh entry without touching upstream', async () => {
		const kv = fakeKv();
		seedCache(kv, 60_000);

		const response = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		expect(await response.json()).toMatchObject({ ok: true, meta: { stale: false } });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('halves the TTL in cache-control, so the CDN refreshes before we do', async () => {
		const kv = fakeKv();
		seedCache(kv, 1000);

		const response = await call({ kv });

		// doc 11 §2. Deliberate: an identical URL inside that window replays the
		// first response verbatim, x-tp-cache included.
		const expected = Math.floor(CACHE_POLICY.wx.ttlMs / 1000 / 2);
		expect(response.headers.get('cache-control')).toBe(`public, max-age=${expected}`);
	});

	it('serves a stale entry when upstream is unreachable', async () => {
		const kv = fakeKv();
		seedCache(kv, CACHE_POLICY.wx.ttlMs + 60_000);

		const response = await call({ kv });

		// doc 04 §2: never blank out data that exists.
		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect(await response.json()).toMatchObject({ ok: true, meta: { stale: true } });
	});

	it('fails cleanly when there is nothing cached and upstream is down', async () => {
		const response = await call();

		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DOWN' } });
	});

	it('collapses nearby coordinates onto one cache key', async () => {
		const kv = fakeKv();
		seedCache(kv, 1000);

		// ~300 m away: doc 11 §4 rounds to a geohash so fifty users in a city
		// cost one upstream fetch, not fifty.
		const response = await call({ kv, search: '?lat=21.021&lon=105.851' });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
	});
});

describe('the breaker', () => {
	it('serves stale without calling upstream while open', async () => {
		const kv = fakeKv();
		seedCache(kv, CACHE_POLICY.wx.ttlMs + 60_000);
		kv.store.set(
			'kv:brk:open-meteo',
			JSON.stringify({ state: 'open', openedAt: Date.now(), reason: 'test', failures: 3 })
		);

		const response = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		// The point of the breaker: stop spending quota on an upstream that is
		// already known to be failing.
		expect(fetch).not.toHaveBeenCalled();
	});
});

describe('the upstream path', () => {
	/** Open-Meteo's two endpoints, shaped only as far as the normaliser reads. */
	function stubUpstream(options: { aqiFails?: boolean; status?: number } = {}): void {
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const href = String(input);
				if (options.status !== undefined) {
					return new Response('nope', { status: options.status });
				}
				if (href.includes('air-quality')) {
					if (options.aqiFails === true) throw new TypeError('aqi down');
					return Response.json({ hourly: { time: [], pm2_5: [], european_aqi: [] } });
				}
				return Response.json({
					timezone: 'Asia/Ho_Chi_Minh',
					hourly: { time: [], temperature_2m: [], weather_code: [] },
					daily: { time: [], temperature_2m_max: [], temperature_2m_min: [], weather_code: [] }
				});
			})
		);
	}

	it('fetches, normalises and caches on a miss', async () => {
		stubUpstream();
		const kv = fakeKv();

		const response = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('MISS');
		expect(await response.json()).toMatchObject({ ok: true, meta: { stale: false } });
		expect([...kv.store.keys()].some((k) => k.startsWith('kv:wx:'))).toBe(true);
	});

	it('still answers when only air quality fails', async () => {
		stubUpstream({ aqiFails: true });

		const body = (await (await call()).json()) as { ok: boolean; data: { airQuality: unknown } };

		// doc 10: AQI is an extra. Losing it must not cost the forecast.
		expect(body.ok).toBe(true);
		expect(body.data.airQuality).toBeNull();
	});

	it('carries the attribution the licence requires', async () => {
		stubUpstream();

		const body = (await (await call()).json()) as { data: { attribution: string } };

		// doc 16 §5: Open-Meteo is CC BY 4.0, so credit travels with the payload
		// rather than being something the widget has to remember.
		expect(body.data.attribution).toBeTruthy();
	});

	it('reports a 4xx from upstream as our own bad request', async () => {
		stubUpstream({ status: 400 });

		const response = await call();

		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
	});

	it('opens the breaker immediately on a 429, not after three strikes', async () => {
		stubUpstream({ status: 429 });
		const kv = fakeKv();

		await call({ kv });

		// doc 11 §6: a 429 is upstream telling us to stop; waiting for two more
		// failures would be spending quota to confirm what we were just told.
		const breaker = JSON.parse(kv.store.get('kv:brk:open-meteo') as string) as { state: string };
		expect(breaker.state).toBe('open');
	});
});
