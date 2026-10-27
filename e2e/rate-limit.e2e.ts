import { expect, test, type APIRequestContext } from '@playwright/test';
import { RATE_LIMIT } from '../src/lib/shared-constants';

/**
 * doc 11 §7's Worker limiter, in workerd: the Rate Limiting bindings really
 * count, per client and per binding, and a burst gets a clean 429. The unit
 * tests fake the binding; this is the only place its counting is checked.
 *
 * **Every burst carries a TEST-NET address.** `wrangler dev` stamps the local
 * client's own address on a request unless one is already there, and the
 * limiter leaves loopback alone so the rest of the suite is never counted
 * (`_lib/ratelimit.ts`). Each test has its own address, so parallel runs do not
 * share a counter.
 *
 * **Bursts start early in a window.** Wrangler's local limiter counts in fixed
 * windows aligned to the clock, so a burst straddling an edge would start
 * counting again halfway through and get a 200 where the 429 belongs.
 */

const DEPLOYED = process.env.S3_BASE_URL;
const LOCAL_ONLY = 'checks the local worker, and none runs with S3_BASE_URL set';

/** The length of one burst, generously; a window with less left is skipped. */
const BURST_MS = 3_000;

async function earlyInWindow(): Promise<void> {
	const left = RATE_LIMIT.bucketMs - (Date.now() % RATE_LIMIT.bucketMs);
	if (left < BURST_MS) await new Promise((done) => setTimeout(done, left + 100));
}

/** One more request than a window allows, all at once, from one address. */
async function burst(request: APIRequestContext, path: string, address: (i: number) => string) {
	const responses = await Promise.all(
		Array.from({ length: RATE_LIMIT.maxPerBucket + 1 }, (_, i) =>
			request.get(path, { headers: { 'cf-connecting-ip': address(i) } })
		)
	);
	return {
		statuses: responses.map((response) => response.status()),
		refused: responses.filter((response) => response.status() === 429)
	};
}

test.beforeEach(() => {
	test.skip(Boolean(DEPLOYED), LOCAL_ONLY);
});

test('an /api burst gets the envelope’s RATE_LIMITED past 30, and other clients do not', async ({
	request
}) => {
	await earlyInWindow();
	const { statuses, refused } = await burst(request, '/api/verify', () => '203.0.113.10');

	expect(statuses.filter((status) => status === 200)).toHaveLength(RATE_LIMIT.maxPerBucket);
	expect(refused).toHaveLength(1);
	const [answer] = refused;
	expect(await answer?.json()).toEqual({
		ok: false,
		error: { code: 'RATE_LIMITED', retryAfterS: RATE_LIMIT.bucketMs / 1000 }
	});
	expect(answer?.headers()['retry-after']).toBe(String(RATE_LIMIT.bucketMs / 1000));
	expect(answer?.headers()['cache-control']).toBe('no-store');

	const neighbour = await request.get('/api/verify', {
		headers: { 'cf-connecting-ip': '198.51.100.10' }
	});
	expect(neighbour.status()).toBe(200);
});

test('rendered pages have an allowance of their own, and static pages never count', async ({
	request
}) => {
	const client = { 'cf-connecting-ip': '203.0.113.11' };
	await earlyInWindow();
	const { statuses, refused } = await burst(
		request,
		'/khong-ton-tai',
		() => client['cf-connecting-ip']
	);

	expect(statuses.filter((status) => status === 404)).toHaveLength(RATE_LIMIT.maxPerBucket);
	expect(refused).toHaveLength(1);
	expect(await refused[0]?.text()).toBe('');
	expect(refused[0]?.headers()['retry-after']).toBe(String(RATE_LIMIT.bucketMs / 1000));

	// Same client, same window: the API allowance is untouched, and a
	// prerendered page is served by the assets layer before the Worker runs.
	expect((await request.get('/api/verify', { headers: client })).status()).toBe(200);
	expect((await request.get('/about', { headers: client })).status()).toBe(200);
});

test('an IPv6 client cannot rotate out of the limit inside its /64', async ({ request }) => {
	await earlyInWindow();
	const { refused } = await burst(request, '/api/verify', (i) => `2001:db8:a:b::${String(i + 1)}`);

	expect(refused).toHaveLength(1);
});

test('local requests are never counted, which the rest of the suite relies on', async ({
	request
}) => {
	const statuses = await Promise.all(
		Array.from({ length: RATE_LIMIT.maxPerBucket + 10 }, async () =>
			(await request.get('/api/verify')).status()
		)
	);

	expect(statuses.every((status) => status === 200)).toBe(true);
});
