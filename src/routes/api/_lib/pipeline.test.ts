import { describe, it, expect, beforeEach } from 'vitest';
import { BREAKER, CACHE_POLICY, RATE_LIMIT, STOCK_BUDGET } from '$lib/shared-constants';
import {
	breakerVerdict,
	msUntilUtcMidnight,
	readBreaker,
	recordFailure,
	recordSuccess
} from './breaker';
import { mayFetch, parseCreditsLeft, readSpend, recordSpend, utcDateKey } from './budget';
import { readCache, ttlSeconds, writeCache } from './kv-cache';
import { checkRateLimit } from './ratelimit';
import { parseCoords } from './geohash';

/**
 * Worker `_lib` suite — doc 19 §3.5.
 *
 * Runs against a KV stand-in rather than miniflare: every behaviour under test
 * here is our own logic layered on `get`/`put`, and the parts that genuinely
 * need the real runtime (bindings, `waitUntil`) are covered by the e2e suite
 * against `wrangler dev`. A fake keeps these tests fast and lets them control
 * the clock, which the breaker and budget tiers both need.
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
		put: (async (key: string, value: string) => {
			store.set(key, String(value));
		}) as KVNamespace['put'],
		delete: (async (key: string) => void store.delete(key)) as KVNamespace['delete'],
		list: (async () => ({ keys: [], list_complete: true })) as unknown as KVNamespace['list'],
		getWithMetadata: (async () => ({
			value: null,
			metadata: null,
			cacheStatus: null
		})) as unknown as KVNamespace['getWithMetadata']
	} as KVNamespace & { store: Map<string, string> };
}

describe('kv cache freshness (doc 11 §4)', () => {
	let kv: ReturnType<typeof fakeKv>;
	beforeEach(() => (kv = fakeKv()));

	it('is HIT inside the TTL and STALE past it', async () => {
		const t0 = Date.parse('2026-08-10T00:00:00Z');
		await writeCache(kv, 'wx', 'wx:v1:test', { n: 1 }, 'open-meteo', t0);

		const fresh = await readCache(kv, 'wx', 'wx:v1:test', t0 + CACHE_POLICY.wx.ttlMs - 1);
		expect(fresh.status).toBe('HIT');

		const stale = await readCache(kv, 'wx', 'wx:v1:test', t0 + CACHE_POLICY.wx.ttlMs + 1);
		expect(stale.status).toBe('STALE');
		// Still readable — serving it is the endpoint's decision, not the cache's.
		expect(stale.value?.payload).toEqual({ n: 1 });
	});

	it('reports MISS for an absent key', async () => {
		const read = await readCache(kv, 'wx', 'nope');
		expect(read.status).toBe('MISS');
		expect(read.value).toBeNull();
	});

	it('derives cache-control from the TTL table', () => {
		expect(ttlSeconds('wx')).toBe(CACHE_POLICY.wx.ttlMs / 1000);
		// fxSnap is permanent, so there is no sensible max-age.
		expect(ttlSeconds('fxSnap')).toBe(0);
	});
});

describe('circuit breaker (doc 11 §6)', () => {
	let kv: ReturnType<typeof fakeKv>;
	beforeEach(() => (kv = fakeKv()));

	it('stays closed until the third consecutive failure', async () => {
		for (let i = 1; i < BREAKER.failureThreshold; i++) {
			const record = await recordFailure(kv, 'open-meteo', '500');
			expect(record.state, `after ${i} failure(s)`).toBe('closed');
		}
		const opened = await recordFailure(kv, 'open-meteo', '500');
		expect(opened.state).toBe('open');
	});

	it('opens immediately on 429 or 418', async () => {
		const record = await recordFailure(kv, 'binance', '418', { immediate: true });
		expect(record.state).toBe('open');
		expect(record.failures).toBe(1);
	});

	it('a success resets the failure count', async () => {
		await recordFailure(kv, 'open-meteo', '500');
		await recordFailure(kv, 'open-meteo', '500');
		await recordSuccess(kv, 'open-meteo');
		expect((await readBreaker(kv, 'open-meteo')).failures).toBe(0);
	});

	it('goes half-open exactly at the cool-down, not before', () => {
		const openedAt = Date.parse('2026-08-10T12:00:00Z');
		const record = { state: 'open' as const, openedAt, reason: '500', failures: 3 };

		expect(breakerVerdict(record, openedAt + BREAKER.cooldownMs - 1)).toBe('open');
		expect(breakerVerdict(record, openedAt + BREAKER.cooldownMs)).toBe('half-open');
	});

	it('a quota trip holds until UTC midnight, not for the short cool-down', () => {
		const openedAt = Date.parse('2026-08-10T12:00:00Z');
		const record = {
			state: 'open' as const,
			openedAt,
			reason: 'quota',
			failures: 1,
			untilUtcMidnight: true
		};

		// Long past the normal cool-down, still open.
		expect(breakerVerdict(record, openedAt + BREAKER.cooldownMs * 10)).toBe('open');
		expect(breakerVerdict(record, Date.parse('2026-08-11T00:00:00Z'))).toBe('half-open');
	});

	it('computes the time to UTC midnight', () => {
		const noon = Date.parse('2026-08-10T12:00:00Z');
		expect(msUntilUtcMidnight(noon)).toBe(12 * 60 * 60 * 1000);
	});
});

describe('Twelve Data budget tiers (doc 11 §5)', () => {
	let kv: ReturnType<typeof fakeKv>;
	beforeEach(() => (kv = fakeKv()));

	it('stops intraday at 720 while daily continues to 780', () => {
		expect(mayFetch('intraday', STOCK_BUDGET.intradayStopAt - 1)).toBe(true);
		expect(mayFetch('intraday', STOCK_BUDGET.intradayStopAt)).toBe(false);

		expect(mayFetch('daily', STOCK_BUDGET.intradayStopAt)).toBe(true);
		expect(mayFetch('daily', STOCK_BUDGET.dailySeriesStopAt)).toBe(false);
	});

	it('takes the pessimistic view when upstream disagrees with our counter', () => {
		// We think we have spent 10, upstream says only 50 credits remain — i.e.
		// 750 spent. The header wins because it is the real figure.
		expect(mayFetch('intraday', 10, 50)).toBe(false);
		// And the reverse: our counter is higher, so it wins.
		expect(mayFetch('intraday', 730, 700)).toBe(false);
		// Both agree there is room.
		expect(mayFetch('intraday', 10, 790)).toBe(true);
	});

	it('accumulates spend per UTC day', async () => {
		const t0 = Date.parse('2026-08-10T23:59:00Z');
		await recordSpend(kv, 5, t0);
		await recordSpend(kv, 3, t0);
		expect(await readSpend(kv, t0)).toBe(8);

		// A minute later it is a new UTC day and the counter starts clean.
		const t1 = Date.parse('2026-08-11T00:01:00Z');
		expect(await readSpend(kv, t1)).toBe(0);
		expect(utcDateKey(t1)).toBe('2026-08-11');
	});

	it('parses api-credits-left, and ignores nonsense', () => {
		expect(parseCreditsLeft(new Headers({ 'api-credits-left': '742' }))).toBe(742);
		expect(parseCreditsLeft(new Headers())).toBeUndefined();
		expect(parseCreditsLeft(new Headers({ 'api-credits-left': 'lots' }))).toBeUndefined();
	});
});

describe('soft rate limiter (doc 11 §7, doc 15 §7)', () => {
	let kv: ReturnType<typeof fakeKv>;
	beforeEach(() => (kv = fakeKv()));

	const req = (ip: string) =>
		new Request('https://tilepier.win/api/weather', {
			headers: { 'cf-connecting-ip': ip }
		});

	it('allows up to the bucket limit and then refuses', async () => {
		const now = Date.parse('2026-08-10T12:00:00Z');
		for (let i = 0; i < RATE_LIMIT.maxPerBucket; i++) {
			expect((await checkRateLimit(kv, req('203.0.113.9'), now)).allowed, `request ${i}`).toBe(
				true
			);
		}
		const blocked = await checkRateLimit(kv, req('203.0.113.9'), now);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterS).toBeGreaterThan(0);
	});

	it('counts per address, not globally', async () => {
		const now = Date.parse('2026-08-10T12:00:00Z');
		for (let i = 0; i < RATE_LIMIT.maxPerBucket; i++) {
			await checkRateLimit(kv, req('203.0.113.9'), now);
		}
		expect((await checkRateLimit(kv, req('198.51.100.4'), now)).allowed).toBe(true);
	});

	it('never stores a raw IP address', async () => {
		const now = Date.parse('2026-08-10T12:00:00Z');
		await checkRateLimit(kv, req('203.0.113.9'), now);

		const keys = [...kv.store.keys()].join('|');
		expect(keys).not.toContain('203.0.113.9');
		expect(keys).toMatch(/kv:rl:[0-9a-f]{20}:/);
	});

	it('allows requests with no address rather than inventing one', async () => {
		const anonymous = new Request('https://tilepier.win/api/weather');
		expect((await checkRateLimit(kv, anonymous)).allowed).toBe(true);
	});
});

describe('coordinate handling (doc 15 §7)', () => {
	// `roundCoord` and `geohash` moved to `$lib/shared-constants` so the client
	// can spell its own cache key (doc 04 §5); their tests moved with them, to
	// `shared-constants.test.ts`. What is left here is the half that reads a URL.
	it('rounds to 2 dp, so a precise location never reaches KV', () => {
		expect(parseCoords(new URL('https://x/api/weather?lat=21.028511&lon=105.804817'))).toEqual({
			lat: 21.03,
			lon: 105.8
		});
	});

	it('rejects out-of-range and non-numeric input', () => {
		expect(parseCoords(new URL('https://x/api/weather?lat=91&lon=0'))).toBeNull();
		expect(parseCoords(new URL('https://x/api/weather?lat=0&lon=181'))).toBeNull();
		expect(parseCoords(new URL('https://x/api/weather?lat=abc&lon=0'))).toBeNull();
	});
});
