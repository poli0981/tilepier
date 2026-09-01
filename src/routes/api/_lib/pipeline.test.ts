import { describe, it, expect, beforeEach } from 'vitest';
import { BREAKER, CACHE_POLICY, KV_PREFIX, RATE_LIMIT, STOCK_BUDGET } from '$lib/shared-constants';
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
function fakeKv(): KVNamespace & {
	store: Map<string, string>;
	putOptions: Map<string, KVNamespacePutOptions | undefined>;
} {
	const store = new Map<string, string>();
	// Recorded so the expiration arithmetic can be asserted directly. Reading it
	// back out of the fake is the only way to see `expirationTtl`, which never
	// appears in the value.
	const putOptions = new Map<string, KVNamespacePutOptions | undefined>();
	return {
		store,
		putOptions,
		get: (async (key: string, type?: string) => {
			const raw = store.get(key);
			if (raw == null) return null;
			return type === 'json' ? JSON.parse(raw) : raw;
		}) as KVNamespace['get'],
		put: (async (key: string, value: string, options?: KVNamespacePutOptions) => {
			store.set(key, String(value));
			putOptions.set(key, options);
		}) as KVNamespace['put'],
		delete: (async (key: string) => void store.delete(key)) as KVNamespace['delete'],
		list: (async () => ({ keys: [], list_complete: true })) as unknown as KVNamespace['list'],
		getWithMetadata: (async () => ({
			value: null,
			metadata: null,
			cacheStatus: null
		})) as unknown as KVNamespace['getWithMetadata']
	} as KVNamespace & {
		store: Map<string, string>;
		putOptions: Map<string, KVNamespacePutOptions | undefined>;
	};
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

	it('reports MISS past the stale window, rather than trusting KV to have gone', async () => {
		const t0 = Date.parse('2026-08-10T00:00:00Z');
		await writeCache(kv, 'crTick', 'cr:tick:v1:BTCUSDT', { n: 1 }, 'binance', t0);

		const window = CACHE_POLICY.crTick.ttlMs + (CACHE_POLICY.crTick.staleMs ?? 0);
		const inside = await readCache(kv, 'crTick', 'cr:tick:v1:BTCUSDT', t0 + window - 1);
		expect(inside.status).toBe('STALE');

		/*
		 * `writeCache` gives KV an `expirationTtl` of ttl + stale, so in production
		 * the entry is usually gone before this matters — which is what makes it
		 * the wrong thing to rely on. KV expiry is best-effort and not instant, an
		 * entry written by an older build with a longer window is not covered by
		 * it at all, and doc 11 §4 states the window as a promise about how old a
		 * reading may be before it stops being one. (Added 2026-09-01, found by the
		 * crypto ladder asking a 30 s/10 min family for an hour-old entry and
		 * being handed it.)
		 */
		const past = await readCache(kv, 'crTick', 'cr:tick:v1:BTCUSDT', t0 + window + 1);
		expect(past.status).toBe('MISS');
		expect(past.value).toBeNull();
	});

	it('never expires a family that has no stale window', async () => {
		const t0 = Date.parse('2026-08-10T00:00:00Z');
		await writeCache(kv, 'fxSnap', 'fx:snap:2026-08-10', { rates: {} }, 'er-api', t0);

		// `fx:snap:` *is* the currency history (doc 10 §3). Dropping one would be
		// dropping data rather than dropping a derivable.
		const years = await readCache(kv, 'fxSnap', 'fx:snap:2026-08-10', t0 + 3 * 365 * 86_400_000);
		expect(years.value).not.toBeNull();
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

	it('narrows cache-control to what is left of a capped window', () => {
		const now = Date.parse('2026-08-10T00:00:00Z');
		// Two hours left of a 12 h family TTL.
		expect(ttlSeconds('fx', now + 2 * 60 * 60 * 1000, now)).toBe(7200);
		// A cap past the family TTL cannot advertise more than the table allows.
		expect(ttlSeconds('fx', now + 99 * 60 * 60 * 1000, now)).toBe(CACHE_POLICY.fx.ttlMs / 1000);
		// An elapsed window advertises nothing rather than a negative max-age.
		expect(ttlSeconds('fx', now - 1, now)).toBe(0);
	});

	it('honours an upstream cap shorter than the family TTL', async () => {
		// doc 10 §3: /api/fx learns from `time_next_update_unix` that the table it
		// just fetched is superseded before the 12 h in doc 11 §4’s row.
		const t0 = Date.parse('2026-08-10T00:00:00Z');
		const cap = t0 + 2 * 60 * 60 * 1000;
		await writeCache(kv, 'fx', 'fx:v1:USD', { n: 1 }, 'er-api', t0, { freshUntil: cap });

		expect((await readCache(kv, 'fx', 'fx:v1:USD', cap - 1)).status).toBe('HIT');
		expect((await readCache(kv, 'fx', 'fx:v1:USD', cap + 1)).status).toBe('STALE');
	});

	it('never lets an upstream cap lengthen the window', async () => {
		// The assertion that catches a `Math.max` where a `Math.min` belongs. An
		// upstream claiming its next update is nine days out must not stretch a
		// 12 h TTL to nine days — doc 11 §4’s table stays the ceiling.
		const t0 = Date.parse('2026-08-10T00:00:00Z');
		await writeCache(kv, 'fx', 'fx:v1:USD', { n: 1 }, 'er-api', t0, {
			freshUntil: t0 + 9 * 24 * 60 * 60 * 1000
		});

		const justPast = t0 + CACHE_POLICY.fx.ttlMs + 1;
		expect((await readCache(kv, 'fx', 'fx:v1:USD', justPast)).status).toBe('STALE');
	});

	it('ignores a cap already in the past rather than storing one born stale', async () => {
		// A wrong or long-past `time_next_update_unix` would otherwise turn one
		// bad field upstream into a refetch on every single request.
		const t0 = Date.parse('2026-08-10T00:00:00Z');
		await writeCache(kv, 'fx', 'fx:v1:USD', { n: 1 }, 'er-api', t0, { freshUntil: t0 - 1 });

		expect((await readCache(kv, 'fx', 'fx:v1:USD', t0)).status).toBe('HIT');
		const nearlyTtl = t0 + CACHE_POLICY.fx.ttlMs - 1;
		expect((await readCache(kv, 'fx', 'fx:v1:USD', nearlyTtl)).status).toBe('HIT');
	});

	it('keeps the whole stale window past a shortened freshness window', async () => {
		// The cap moves when the value stops being *fresh*; it must not also eat
		// the stale-serve grace doc 11 §4 grants for when upstream is down.
		const t0 = Date.parse('2026-08-10T00:00:00Z');
		const cap = t0 + 2 * 60 * 60 * 1000;
		await writeCache(kv, 'fx', 'fx:v1:USD', { n: 1 }, 'er-api', t0, { freshUntil: cap });

		const written = kv.putOptions.get(`${KV_PREFIX}fx:v1:USD`);
		expect(written?.expirationTtl).toBe((cap - t0 + (CACHE_POLICY.fx.staleMs ?? 0)) / 1000);
	});

	it('writes exactly what it wrote before when no cap is given', async () => {
		// The regression guard for `wx` and `geo`, which never pass options.
		const t0 = Date.parse('2026-08-10T00:00:00Z');
		await writeCache(kv, 'wx', 'wx:v1:test', { n: 1 }, 'open-meteo', t0);

		const stored = JSON.parse(kv.store.get(`${KV_PREFIX}wx:v1:test`) as string) as Record<
			string,
			unknown
		>;
		expect(stored).toEqual({ cachedAt: t0, source: 'open-meteo', payload: { n: 1 } });
		expect(stored).not.toHaveProperty('freshUntil');
		expect(kv.putOptions.get(`${KV_PREFIX}wx:v1:test`)?.expirationTtl).toBe(
			(CACHE_POLICY.wx.ttlMs + (CACHE_POLICY.wx.staleMs ?? 0)) / 1000
		);
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
