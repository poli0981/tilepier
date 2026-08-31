import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_POLICY, cacheKey } from '$lib/shared-constants';
import { SNAPSHOT_BATCH } from '../../_lib/fx-snapshots';
import { GET } from './+server';

/**
 * `/api/fx/history` — doc 11 §3, doc 10 §3.
 *
 * The fake KV counts its reads, because two of the claims here are about reads
 * that must *not* happen: a rejected query never touches the store, and a
 * window is exactly as many gets as it has days.
 */

/** 2026-08-31T10:00:00Z. Every date below is relative to it. */
const NOW = Date.parse('2026-08-31T10:00:00Z');

function fakeKv(): KVNamespace & { store: Map<string, string>; gets: string[] } {
	const store = new Map<string, string>();
	const gets: string[] = [];
	return {
		store,
		gets,
		get: (async (key: string, type?: string) => {
			gets.push(key);
			const raw = store.get(key);
			if (raw == null) return null;
			return type === 'json' ? JSON.parse(raw) : raw;
		}) as KVNamespace['get'],
		put: async (key: string, value: string) => void store.set(key, String(value)),
		delete: async (key: string) => void store.delete(key),
		list: async () => ({ keys: [], list_complete: true }),
		getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null })
	} as unknown as KVNamespace & { store: Map<string, string>; gets: string[] };
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
	search?: string;
	headers?: Record<string, string>;
}

function call(options: CallOptions = {}): Promise<Response> {
	const kv = options.kv === undefined ? fakeKv() : (options.kv ?? undefined);
	const url = new URL(
		`https://tilepier.win/api/fx/history${options.search ?? '?pair=USD-VND&days=7'}`
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

interface HistoryBody {
	ok: boolean;
	data: {
		base: string;
		quote: string;
		points: { date: string; rate: number }[];
		attribution: string;
	};
	meta: { cachedAt: number; stale: boolean };
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('guards', () => {
	it('refuses a cross-site request', async () => {
		const response = await call({ headers: { 'sec-fetch-site': 'cross-site' } });
		expect(response.status).toBe(403);
	});

	it('fails closed when the KV binding is missing', async () => {
		const response = await call({ kv: null });
		expect(response.status).toBe(503);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'UPSTREAM_DOWN' } });
	});
});

describe('the query (doc 11 §3)', () => {
	it('refuses a range outside the allowlist, without reading anything', async () => {
		// A silent clamp would cache one range's answer under another range's
		// key, which is the reasoning `geocode-query.ts` gives for an unknown
		// `lang`. And the refusal has to be free: rejecting after N gets would
		// make a bad request the most expensive kind.
		const kv = fakeKv();

		const response = await call({ kv, search: '?pair=USD-VND&days=91' });

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST' } });
		expect(kv.gets).toHaveLength(0);
	});

	it('refuses a malformed pair', async () => {
		for (const search of [
			'?pair=USDVND',
			'?pair=US-VND',
			'?pair=USD-VNDD',
			'?pair=USD-',
			'?days=90'
		]) {
			expect((await call({ search })).status, search).toBe(400);
		}
	});

	it('refuses a pair with itself on both sides', async () => {
		// A flat line at 1.0 can only come from a bug on the calling side, and
		// answering it would hide that.
		expect((await call({ search: '?pair=USD-USD' })).status).toBe(400);
	});

	it('accepts a lowercase pair, because a URL is not a contract about case', async () => {
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 26_000 });

		const response = await call({ kv, search: '?pair=usd-vnd&days=7' });
		const body = (await response.json()) as HistoryBody;

		expect(body.data.base).toBe('USD');
		expect(body.data.quote).toBe('VND');
	});

	it('defaults to doc 10 §3’s ninety days when no range is asked for', async () => {
		const kv = fakeKv();

		await call({ kv, search: '?pair=USD-VND' });

		// One get per calendar day in the window, and nothing else.
		expect(kv.gets).toHaveLength(90);
	});
});

describe('assembling the series', () => {
	it('cross-rates each day and returns them ascending', async () => {
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-29', { USD: 1, VND: 25_900, EUR: 0.86 });
		seedSnapshot(kv, '2026-08-30', { USD: 1, VND: 25_951.2, EUR: 0.865 });
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 26_006.374497, EUR: 0.862295 });

		const body = (await (await call({ kv, search: '?pair=USD-VND&days=7' })).json()) as HistoryBody;

		expect(body.data.points).toEqual([
			{ date: '2026-08-29', rate: 25_900 },
			{ date: '2026-08-30', rate: 25_951.2 },
			{ date: '2026-08-31', rate: 26_006.374497 }
		]);
	});

	it('divides for a pair that is not based on the dollar', async () => {
		// The whole reason `/api/fx` takes no parameters: one USD table answers
		// every pair, and the division is arithmetic rather than a request.
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 26_000, EUR: 0.8 });

		const body = (await (await call({ kv, search: '?pair=EUR-VND&days=7' })).json()) as HistoryBody;

		expect(body.data.points).toEqual([{ date: '2026-08-31', rate: 32_500 }]);
	});

	it('leaves a day upstream never published simply absent', async () => {
		// doc 10 §3: gaps are legal. Interpolating would invent a rate that never
		// existed, which is why the chart uses a time axis and not an index one.
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-29', { USD: 1, VND: 25_900 });
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 26_000 });

		const body = (await (await call({ kv, search: '?pair=USD-VND&days=7' })).json()) as HistoryBody;

		expect(body.data.points.map((p) => p.date)).toEqual(['2026-08-29', '2026-08-31']);
	});

	it('drops a day whose table is missing one side of the pair', async () => {
		// The doc 08 §2 edge case seen from the server: a currency upstream
		// dropped contributes no point rather than a NaN the chart would plot.
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-30', { USD: 1, VND: 25_951.2 });
		seedSnapshot(kv, '2026-08-31', { USD: 1, EUR: 0.86 });

		const body = (await (await call({ kv, search: '?pair=USD-VND&days=7' })).json()) as HistoryBody;

		expect(body.data.points).toEqual([{ date: '2026-08-30', rate: 25_951.2 }]);
	});

	it('drops a day whose base is something it cannot divide by', async () => {
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-30', { USD: 0, VND: 25_951.2 });
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 26_000 });

		const body = (await (await call({ kv, search: '?pair=USD-VND&days=7' })).json()) as HistoryBody;

		expect(body.data.points).toEqual([{ date: '2026-08-31', rate: 26_000 }]);
	});

	it('answers an empty window with a 200 and no points', async () => {
		// doc 08 §2's "history builds daily from launch" is a state the UI
		// renders, and an empty series is its honest representation on the wire.
		// A 404 here would make a brand-new deployment look broken.
		const response = await call();
		const body = (await response.json()) as HistoryBody;

		expect(response.status).toBe(200);
		expect(body.ok).toBe(true);
		expect(body.data.points).toEqual([]);
	});
});

describe('the response', () => {
	it('reports HIT, because every byte came out of KV', async () => {
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 26_000 });

		const response = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		expect(response.headers.get('cache-control')).toBe(
			`public, max-age=${CACHE_POLICY.fx.ttlMs / 2000}`
		);
	});

	it('stamps itself with the newest point, not with the clock', async () => {
		// Otherwise a chart that stops three days ago reports itself as current,
		// which is exactly the lie `meta.cachedAt` exists to prevent.
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-29', { USD: 1, VND: 25_900 });

		const body = (await (await call({ kv })).json()) as HistoryBody;

		expect(body.meta.cachedAt).toBe(Date.parse('2026-08-29T00:00:00Z') / 1000);
		expect(body.meta.stale).toBe(false);
	});

	it('carries the attribution doc 16 §5 requires', async () => {
		const kv = fakeKv();
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 26_000 });

		const body = (await (await call({ kv })).json()) as HistoryBody;
		expect(body.data.attribution).toBeTruthy();
	});
});

describe('batching (doc 10 §3)', () => {
	it('reads a year in order, whatever the batch size does to it', async () => {
		// The largest allowed window is eight batches. `Promise.all` preserves
		// order inside one and the batches are appended in order, but that is the
		// kind of thing a refactor breaks silently — the series would come back
		// shuffled and the chart would draw a scribble.
		const kv = fakeKv();
		// Three days spread across different batches, so a reordering shows up.
		seedSnapshot(kv, '2025-09-05', { USD: 1, VND: 25_000 });
		seedSnapshot(kv, '2026-05-01', { USD: 1, VND: 25_500 });
		seedSnapshot(kv, '2026-08-31', { USD: 1, VND: 26_000 });

		const body = (await (
			await call({ kv, search: '?pair=USD-VND&days=365' })
		).json()) as HistoryBody;

		expect(kv.gets).toHaveLength(365);
		expect(365 / SNAPSHOT_BATCH).toBeGreaterThan(1);
		expect(body.data.points.map((p) => p.date)).toEqual(['2025-09-05', '2026-05-01', '2026-08-31']);
	});
});
