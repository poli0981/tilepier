import { expect, test, type APIRequestContext } from '@playwright/test';
import type { TpHealthReport } from '../src/lib/api-types';
import { CACHE_POLICY, STOCK_BUDGET } from '../src/lib/shared-constants';

/**
 * Spike S3 — API quota and cache reality check (doc 22 §S3).
 *
 * **Every request here carries a unique `cb` parameter, and that is load
 * bearing.** doc 11 §2 sets `cache-control: public, max-age=<ttl/2>` on
 * purpose, so the CDN and the browser absorb repeat hits. The consequence is
 * that two identical URLs never reach the Worker twice: the second gets the
 * *first response replayed*, `x-tp-cache: MISS` header and all. Measuring the
 * KV hit rate that way reports 0 % while the cache is working perfectly — it
 * measures HTTP caching, not KV. The buster changes the CDN key and nothing
 * else; the Worker derives its KV key from lat/lon alone.
 *
 * **What this measures and what it cannot.** Open-Meteo needs no key, so
 * `/api/weather` is exercised against the real upstream through the real
 * worker with a real KV namespace. The Twelve Data and Finnhub halves need
 * secrets that live on the deployed Worker, not on this machine — the `_lib`
 * unit suite covers their logic (tiers, breaker, header parsing), and the keyed
 * run at the bottom of this file covers the rest against a deployed Worker.
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

/**
 * Against a deployed Worker the Turnstile gate is on (doc 15 §3), so a script
 * needs the `DEV_DASH_TOKEN` bypass. Read from the environment and sent as a
 * header, never written anywhere — it is the same secret `/api/_health`
 * answers to, and a log line holding it would be a leak.
 */
const BEARER = process.env.S3_BEARER;
const gateBypass = BEARER ? { authorization: `Bearer ${BEARER}` } : undefined;

/** A URL the CDN has never seen, resolving to the same KV key. */
let counter = 0;
const bust = () => `${Date.now()}-${counter++}`;
const uncached = (place: { lat: number; lon: number }) =>
	`/api/weather?lat=${place.lat}&lon=${place.lon}&cb=${bust()}`;

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

		const api = await playwright.request.newContext({
			baseURL: DEPLOYED,
			...(gateBypass ? { extraHTTPHeaders: gateBypass } : {})
		});

		// Warm each place once, serially, so the measurement is not racing itself.
		for (const place of PLACES) {
			const res = await api.get(uncached(place));
			expect(res.status(), 'the deployed worker refused the warm-up').toBe(200);
		}

		const statuses: string[] = [];
		// Every virtual user asks for every place, concurrently — the shape of a
		// morning when everyone opens their deck at once.
		await Promise.all(
			Array.from({ length: VIRTUAL_USERS }, async () => {
				for (const place of PLACES) {
					const res = await api.get(uncached(place));
					statuses.push(res.headers()['x-tp-cache'] ?? `no-header:${res.status()}`);
				}
			})
		);
		await api.dispose();

		const total = statuses.length;
		const hits = statuses.filter((s) => s === 'HIT').length;
		const misses = statuses.filter((s) => s === 'MISS').length;
		const hitRate = hits / total;

		const breakdown = statuses.reduce<Record<string, number>>((acc, s) => {
			acc[s] = (acc[s] ?? 0) + 1;
			return acc;
		}, {});
		console.log(
			`S3: ${total} requests · hit rate ${(hitRate * 100).toFixed(1)}% · ${JSON.stringify(breakdown)}`
		);

		expect(hitRate, `hit rate ${(hitRate * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.85);
		expect(misses, 'a warm cache still went upstream').toBe(0);
	});

	test('nearby coordinates are answered from one cache key', async ({ request }) => {
		// Two people a kilometre apart must share one KV entry, or the model in
		// doc 11 §5 falls apart the moment a city has more than one user. The
		// key derivation is unit-tested; this checks the endpoint honours the
		// 2 dp rounding it is built on, so both requests land on the same key.
		const a = await request.get(uncached({ lat: 21.028511, lon: 105.804817 }));
		const b = await request.get(uncached({ lat: 21.0301, lon: 105.8009 }));

		expect(a.status()).toBe(200);
		expect(b.status()).toBe(200);

		// Rounded server-side before anything is stored or logged (doc 15 §7).
		expect((await a.json()).data.place).toMatchObject({ lat: 21.03, lon: 105.8 });
		expect((await b.json()).data.place).toMatchObject({ lat: 21.03, lon: 105.8 });
	});

	test('the envelope matches doc 11 §2 exactly', async ({ request }) => {
		const res = await request.get(uncached({ lat: 21.03, lon: 105.8 }));
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
		// (Binance.US, keyless), so 2 stocks reach Twelve Data.
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

/**
 * The keyed half of S3, which doc 22 held over to Week 5b: it needs the
 * Finnhub and Twelve Data keys, and those exist only on the deployed Worker.
 *
 *     S3_BASE_URL=https://tilepier.win S3_BEARER=<DEV_DASH_TOKEN> \
 *       pnpm exec playwright test e2e/s3-quota.e2e.ts -g keyed
 *
 * With `S3_BASE_URL` set, `playwright.config.ts` starts no local server: this
 * file only talks to the deployed origin.
 *
 * It spends at most two Twelve Data credits, and asserts that is all it
 * spends: the claim is doc 11 §5's — a warm series is a KV read, so the twenty
 * requests after the first two cost nothing however they are spelled.
 *
 * Finnhub's missing `/stock/candle` (doc 10 §5) cannot be shown from here,
 * because the Worker never asks for it. doc 22 §S3 records the one-line curl
 * that shows the 403 with the key on the reader's own machine.
 */
test.describe('S3 · the stock half, keyed', () => {
	const DEPLOYED = process.env.S3_BASE_URL;

	async function health(api: APIRequestContext): Promise<TpHealthReport> {
		const res = await api.get('/api/_health');
		expect(res.status(), 'the bearer was refused — is S3_BEARER the deployed token?').toBe(200);
		return ((await res.json()) as { data: TpHealthReport }).data;
	}

	test('quotes, series and search answer, and a warm series costs nothing', async ({
		playwright
	}) => {
		test.skip(!DEPLOYED || !gateBypass, 'set S3_BASE_URL and S3_BEARER — see the note above');
		test.setTimeout(120_000);

		const api = await playwright.request.newContext({
			baseURL: DEPLOYED,
			extraHTTPHeaders: gateBypass ?? {}
		});

		const before = await health(api);
		expect(before.keys, 'a key is missing on this deploy').toEqual({
			finnhub: true,
			twelvedata: true,
			turnstile: true
		});

		const quote = await api.get(`/api/stock/quote?symbols=AAPL,MSFT&cb=${bust()}`);
		expect(quote.status()).toBe(200);
		const quotes = (
			(await quote.json()) as { data: { quotes: Record<string, { price: number } | null> } }
		).data.quotes;
		expect(quotes['AAPL']?.price).toBeGreaterThan(0);
		expect(quotes['MSFT']?.price).toBeGreaterThan(0);

		const warm: string[] = [];
		for (const [interval, limit] of [
			['15min', 26],
			['1day', 252]
		] as const) {
			const url = () =>
				`/api/stock/series?symbol=AAPL&interval=${interval}&limit=${limit}&cb=${bust()}`;
			const first = await api.get(url());
			expect(first.status(), interval).toBe(200);
			const body = (await first.json()) as { data: { candles: unknown[] } };
			expect(body.data.candles.length, interval).toBeGreaterThan(0);

			for (let i = 0; i < 10; i++) {
				const again = await api.get(url());
				warm.push(`${interval}:${again.headers()['x-tp-cache'] ?? again.status()}`);
			}
		}

		const search = await api.get(`/api/stock/search?q=apple&cb=${bust()}`);
		expect(search.status()).toBe(200);
		const found = ((await search.json()) as { data: { results: { symbol: string }[] } }).data
			.results;
		expect(found.some((result) => result.symbol === 'AAPL')).toBe(true);

		const after = await health(api);
		await api.dispose();

		console.log(
			`S3 keyed · colo ${after.colo ?? '?'} · Twelve Data spend ${before.budget.spent} → ${after.budget.spent} · warm ${JSON.stringify(warm)}`
		);

		expect(
			warm.filter((status) => status.endsWith('MISS')),
			'a warm series went upstream'
		).toEqual([]);
		expect(after.budget.spent - before.budget.spent).toBeLessThanOrEqual(2);
	});
});
