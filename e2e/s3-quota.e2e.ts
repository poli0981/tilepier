import { expect, test } from '@playwright/test';
import { CACHE_POLICY, STOCK_BUDGET } from '../src/lib/shared-constants';

/**
 * Spike S3 — API quota and cache reality check (doc 22 §S3).
 *
 * **What this measures and what it cannot.** Open-Meteo needs no key, so
 * `/api/weather` is exercised against the real upstream through the real
 * worker with a real KV namespace. The Twelve Data and Finnhub halves need
 * secrets that live on the deployed Worker, not on this machine — those are
 * covered by the `_lib` unit suite (tiers, breaker, header parsing) and are
 * marked in doc 22 as needing a keyed run.
 *
 * The claim under test is doc 11 §5's load model: **watchlists share KV, so
 * 500 users on the same place cost the same as one.** That is what makes the
 * free tier survivable, and it is measurable in seconds rather than eight
 * hours — the TTL only has to be longer than the test.
 */

const PLACES = [
	{ lat: 21.03, lon: 105.8 }, // Hà Nội
	{ lat: 10.78, lon: 106.7 }, // TP.HCM
	{ lat: 16.05, lon: 108.2 }, // Đà Nẵng
	{ lat: 35.68, lon: 139.65 } // Tokyo
];

const VIRTUAL_USERS = 50;

test.describe('S3 · cache behaviour under load', () => {
	test.setTimeout(180_000);

	// Deliberately not run locally. Doc 22 §S3 says to "deploy a scratch Worker
	// … and script 50 virtual users against **it**", and that wording turns out
	// to be load-bearing: in `wrangler dev`, a KV `put` is not visible to a
	// later `get` in the same process. Entries written by an earlier run read
	// back fine — so persistence works and only same-process read-after-write
	// does not — which makes every request in a local burst report MISS and the
	// hit rate read 0 %. Measuring here would measure miniflare, not the cache.
	//
	// Run against a deployed Worker with `S3_BASE_URL` set to its origin.
	const DEPLOYED = process.env.S3_BASE_URL;

	test(`${VIRTUAL_USERS} users over ${PLACES.length} places cost ${PLACES.length} upstream fetches`, async ({
		playwright
	}) => {
		test.skip(!DEPLOYED, 'set S3_BASE_URL to a deployed Worker origin — see the note above');

		const api = await playwright.request.newContext({ baseURL: DEPLOYED });

		// Warm each place once, serially, so the measurement is not racing itself.
		for (const place of PLACES) {
			const res = await api.get(`/api/weather?lat=${place.lat}&lon=${place.lon}`);
			expect(res.status(), 'the deployed worker refused the warm-up').toBe(200);
		}

		const statuses: string[] = [];
		// Every virtual user asks for every place, concurrently — the shape of a
		// morning when everyone opens their deck at once.
		await Promise.all(
			Array.from({ length: VIRTUAL_USERS }, async () => {
				for (const place of PLACES) {
					const res = await api.get(`/api/weather?lat=${place.lat}&lon=${place.lon}`);
					statuses.push(res.headers()['x-tp-cache'] ?? 'none');
				}
			})
		);
		await api.dispose();

		const total = statuses.length;
		const hits = statuses.filter((s) => s === 'HIT').length;
		const misses = statuses.filter((s) => s === 'MISS').length;
		const hitRate = hits / total;

		console.log(
			`S3: ${total} requests · ${hits} HIT · ${misses} MISS · hit rate ${(hitRate * 100).toFixed(1)}%`
		);

		expect(hitRate, `hit rate ${(hitRate * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.85);
		expect(misses, 'a warm cache still went upstream').toBe(0);
	});

	test('nearby coordinates are answered from one cache key', async ({ request }) => {
		// Two people a kilometre apart must share one KV entry, or the model in
		// doc 11 §5 falls apart the moment a city has more than one user. The
		// key derivation is unit-tested; this checks the endpoint honours the
		// 2 dp rounding it is built on, so both requests land on the same key.
		const a = await request.get('/api/weather?lat=21.028511&lon=105.804817');
		const b = await request.get('/api/weather?lat=21.0301&lon=105.8009');

		expect(a.status()).toBe(200);
		expect(b.status()).toBe(200);

		// Rounded server-side before anything is stored or logged (doc 15 §7).
		expect((await a.json()).data.place).toMatchObject({ lat: 21.03, lon: 105.8 });
		expect((await b.json()).data.place).toMatchObject({ lat: 21.03, lon: 105.8 });
	});

	test('the envelope matches doc 11 §2 exactly', async ({ request }) => {
		const res = await request.get('/api/weather?lat=21.03&lon=105.8');
		const body = await res.json();

		expect(body.ok).toBe(true);
		expect(body.meta).toMatchObject({ source: 'open-meteo', stale: false });
		expect(typeof body.meta.cachedAt).toBe('number');
		expect(body.data.attribution).toContain('Open-Meteo');
		expect(body.data.place).toMatchObject({ lat: 21.03, lon: 105.8 });

		expect(['HIT', 'MISS', 'STALE']).toContain(res.headers()['x-tp-cache']);
		// doc 11 §2: half the TTL, so the CDN and browser absorb repeats.
		expect(res.headers()['cache-control']).toBe(`public, max-age=${CACHE_POLICY.wx.ttlMs / 2000}`);
	});

	test('bad input is rejected before any upstream call', async ({ request }) => {
		for (const query of ['lat=91&lon=0', 'lat=0&lon=181', 'lat=abc&lon=0', '']) {
			const res = await request.get(`/api/weather?${query}`);
			expect(res.status(), `query "${query}"`).toBe(400);
			expect((await res.json()).error.code).toBe('BAD_REQUEST');
		}
	});

	test('non-GET is refused', async ({ request }) => {
		const res = await request.post('/api/weather?lat=21.03&lon=105.8');
		// doc 11 §3: "Non-GET → 405". SvelteKit answers 405 for a route with no
		// POST handler, which is the same contract.
		expect(res.status()).toBe(405);
	});
});

test.describe('S3 · the quota model on paper', () => {
	test('the 8-hour, 50-user weather model stays inside its budget', () => {
		// Doc 22 asks for "50 virtual users × 8 h". The concurrency test above
		// proves the mechanism; the arithmetic is what shows the day's total,
		// and it is worth asserting so a TTL change cannot silently break it.
		const HOURS = 8;
		const pollsPerUserPerPlace = (HOURS * 3600_000) / CACHE_POLICY.wx.ttlMs;
		const clientRequests = 50 * PLACES.length * pollsPerUserPerPlace;

		// Upstream fetches depend only on distinct places and the TTL.
		const upstreamFetches = PLACES.length * pollsPerUserPerPlace;
		const hitRate = 1 - upstreamFetches / clientRequests;

		expect(pollsPerUserPerPlace).toBe(48);
		expect(upstreamFetches).toBe(192);
		expect(hitRate).toBeCloseTo(0.98, 2);
	});

	test('a full day of warm stock symbols stays under the Twelve Data ceiling', () => {
		// doc 11 §5: 15 min TTL → ≤ 96 calls/day per symbol-interval; 6 h daily
		// TTL → ≤ 4. The default watchlist is 4 symbols, 2 of them crypto
		// (Binance, keyless), so 2 stocks reach Twelve Data.
		const perDay = (ttlMs: number) => Math.floor(86_400_000 / ttlMs);

		expect(perDay(CACHE_POLICY.stSeries15min.ttlMs)).toBe(96);
		expect(perDay(CACHE_POLICY.stSeries1day.ttlMs)).toBe(4);

		const stockSymbols = 2;
		const dailyCost =
			stockSymbols *
			(perDay(CACHE_POLICY.stSeries15min.ttlMs) + perDay(CACHE_POLICY.stSeries1day.ttlMs));

		expect(dailyCost).toBe(200);
		// Comfortably below the intraday guard, which is the point: the guard is
		// for the long tail of unique symbols, not the default deck.
		expect(dailyCost).toBeLessThan(STOCK_BUDGET.intradayStopAt);
	});
});
