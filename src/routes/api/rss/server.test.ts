import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TpFeedPayload } from '$lib/api-types';
import { RATE_LIMIT, cacheKey, feedUrlHash } from '$lib/shared-constants';
import { HTML_PAGE, RSS_NEWS } from '../_lib/__fixtures__/feeds';
import { GET } from './+server';

/**
 * doc 11 §3's `/api/rss`, driven by calling the handler with stubs the way the
 * other endpoint suites are. The helper is `crypto/ticker/server.test.ts`'s,
 * whose two load-bearing details this keeps: `kv: null` spelled apart from an
 * omitted option, and a real `ctx.waitUntil`, so a cache write is awaited
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

const FEED_URL = 'https://news.example.vn/rss/tin-moi-nhat.rss';

interface CallOptions {
	/** Omitted gives a working fake; `null` means the binding is genuinely absent. */
	kv?: (KVNamespace & { store: Map<string, string> }) | null;
	/** The whole query string; defaults to the one feed above. */
	search?: string;
	headers?: Record<string, string>;
	/** The host the Worker is answering on; a `workers.dev` preview is not tilepier.win. */
	host?: string;
}

interface CallResult {
	response: Response;
	settled: Promise<unknown>;
}

async function call(options: CallOptions = {}): Promise<CallResult> {
	const kv = options.kv === undefined ? fakeKv() : (options.kv ?? undefined);
	const url = new URL(
		`https://${options.host ?? 'tilepier.win'}/api/rss${options.search ?? `?url=${encodeURIComponent(FEED_URL)}`}`
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

interface Envelope {
	ok: boolean;
	data: TpFeedPayload;
	meta: { cachedAt: number; source: string; stale: boolean };
	error?: { code: string };
}

async function envelope(response: Response): Promise<Envelope> {
	return (await response.json()) as Envelope;
}

async function kvKey(url = FEED_URL): Promise<string> {
	return `kv:${cacheKey.rss(await feedUrlHash(url))}`;
}

function seed(
	kv: KVNamespace & { store: Map<string, string> },
	key: string,
	payload: TpFeedPayload,
	ageMs: number
): void {
	kv.store.set(key, JSON.stringify({ cachedAt: Date.now() - ageMs, source: 'rss', payload }));
}

const HELD: TpFeedPayload = {
	kind: 'feed',
	feed: {
		title: 'Held copy',
		link: 'https://news.example.vn/',
		lang: 'vi',
		items: [
			{
				id: 'held-1',
				title: 'From before',
				link: 'https://news.example.vn/1',
				summaryHtml: '<p>kept</p>',
				publishedAt: 1_790_000_000_000,
				author: null
			}
		]
	}
};

const MINUTE = 60_000;

function answer(body: string, init: ResponseInit = {}): () => Promise<Response> {
	return async () =>
		new Response(body, {
			status: 200,
			headers: { 'content-type': 'application/rss+xml; charset=utf-8' },
			...init
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

describe('validation (doc 11 §3, doc 15 §5)', () => {
	it.each([
		['no url', ''],
		['two urls', `?url=${encodeURIComponent(FEED_URL)}&url=${encodeURIComponent(FEED_URL)}`],
		['http', `?url=${encodeURIComponent('http://news.example.vn/rss')}`],
		['an address', `?url=${encodeURIComponent('https://10.0.0.1/rss')}`],
		['this app', `?url=${encodeURIComponent('https://tilepier.win/api/rss')}`],
		// The client only ever sends the canonical spelling; any other is two
		// edge entries for one answer (feed-query.ts).
		[
			'a non-canonical spelling',
			`?url=${encodeURIComponent('HTTPS://News.Example.VN/rss/tin-moi-nhat.rss')}`
		],
		['a fragment', `?url=${encodeURIComponent(`${FEED_URL}#top`)}`]
	])('refuses %s as BAD_REQUEST, before any fetch', async (_name, search) => {
		const { response } = await call({ search });

		expect(response.status).toBe(400);
		expect((await envelope(response)).error?.code).toBe('BAD_REQUEST');
		expect(fetch).not.toHaveBeenCalled();
	});

	it('refuses another site embedding the endpoint', async () => {
		const { response } = await call({ headers: { 'sec-fetch-site': 'cross-site' } });
		expect(response.status).toBe(403);
	});

	it('is UPSTREAM_DOWN when the KV binding is missing', async () => {
		const { response } = await call({ kv: null });
		expect(response.status).toBe(503);
		expect((await envelope(response)).error?.code).toBe('UPSTREAM_DOWN');
	});

	it('is rate-gated like every other route (doc 11 §7)', async () => {
		const kv = fakeKv();
		seed(kv, await kvKey(), HELD, 0);
		const headers = { 'cf-connecting-ip': '203.0.113.9' };

		for (let i = 0; i < RATE_LIMIT.maxPerBucket; i += 1) {
			expect((await call({ kv, headers })).response.status).toBe(200);
		}
		const { response } = await call({ kv, headers });

		expect(response.status).toBe(429);
		expect((await envelope(response)).error?.code).toBe('RATE_LIMITED');
	});
});

describe('a feed', () => {
	it('is fetched, normalised, cached under the SHA-256 key, and served MISS', async () => {
		vi.stubGlobal('fetch', vi.fn(answer(RSS_NEWS)));
		const kv = fakeKv();

		const { response, settled } = await call({ kv });
		await settled;

		const body = await envelope(response);
		expect(response.status).toBe(200);
		expect(response.headers.get('x-tp-cache')).toBe('MISS');
		// Half the family TTL (doc 11 §2), so the edge absorbs repeat hits.
		expect(response.headers.get('cache-control')).toBe('public, max-age=600');
		expect(body.meta).toMatchObject({ source: 'rss', stale: false });
		expect(body.data.kind).toBe('feed');
		expect(body.data.kind === 'feed' && body.data.feed.items[0]?.title).toBe(
			'Giá xăng giảm từ chiều nay'
		);
		expect(kv.store.has(await kvKey())).toBe(true);
	});

	it('is served from KV while fresh, without asking the host again', async () => {
		const kv = fakeKv();
		seed(kv, await kvKey(), HELD, MINUTE);

		const { response } = await call({ kv });

		expect(response.headers.get('x-tp-cache')).toBe('HIT');
		expect((await envelope(response)).data).toEqual(HELD);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('sends the host nothing of the reader: no cookie, no pass', async () => {
		const respond = answer(RSS_NEWS);
		const spy = vi.fn((_input: RequestInfo | URL, _init?: RequestInit) => respond());
		vi.stubGlobal('fetch', spy);

		await call({ headers: { cookie: 'a=b', 'x-tp-pass': 'v1.secret', authorization: 'Bearer x' } });

		const init = spy.mock.calls[0]?.[1] as RequestInit | undefined;
		const sent = new Headers(init?.headers);
		expect(sent.get('cookie')).toBeNull();
		expect(sent.get('x-tp-pass')).toBeNull();
		expect(sent.get('authorization')).toBeNull();
		expect(sent.get('user-agent')).toMatch(/^TilePier\//);
	});
});

describe('what is not a feed (doc 11 §2: an answer, not a failure)', () => {
	it('answers an HTML page as not-feed, and caches that answer', async () => {
		vi.stubGlobal('fetch', vi.fn(answer(HTML_PAGE, { headers: { 'content-type': 'text/html' } })));
		const kv = fakeKv();

		const first = await call({ kv });
		await first.settled;
		expect(first.response.status).toBe(200);
		expect((await envelope(first.response)).data).toEqual({
			kind: 'unavailable',
			reason: 'not-feed'
		});

		// Asking again costs the host nothing.
		const second = await call({ kv });
		expect(second.response.headers.get('x-tp-cache')).toBe('HIT');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('answers a 404 as gone', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('missing', { status: 404 }))
		);

		const { response } = await call();

		expect((await envelope(response)).data).toEqual({ kind: 'unavailable', reason: 'gone' });
	});

	it('answers a redirect to http as blocked, which is not our request being bad', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(null, { status: 301, headers: { location: 'http://news.example.vn/rss' } })
			)
		);

		const { response } = await call();

		expect(response.status).toBe(200);
		expect((await envelope(response)).data).toEqual({
			kind: 'unavailable',
			reason: 'blocked-redirect'
		});
	});

	it('refuses a redirect back to whatever host this Worker answers on', async () => {
		// tilepier.win is refused by name; a preview on workers.dev is refused
		// only because the endpoint hands its own host to the guard. Found by a
		// mutation run: dropping that argument left every other case green.
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(null, {
						status: 302,
						headers: { location: 'https://tilepier.demo.workers.dev/api/rss' }
					})
			)
		);

		const { response } = await call({ host: 'tilepier.demo.workers.dev' });

		expect((await envelope(response)).data).toEqual({
			kind: 'unavailable',
			reason: 'blocked-redirect'
		});
	});

	it('never writes over a feed it still holds — a maintenance page is not the feed gone', async () => {
		// The plan review's second blocker. A 200 HTML page would otherwise replace
		// the last good copy in KV, and through `swr` in the reader's Dexie cache
		// too — the one thing doc 04 §2 forbids.
		vi.stubGlobal('fetch', vi.fn(answer(HTML_PAGE, { headers: { 'content-type': 'text/html' } })));
		const kv = fakeKv();
		const key = await kvKey();
		seed(kv, key, HELD, 30 * MINUTE);
		const before = kv.store.get(key);

		const { response, settled } = await call({ kv });
		await settled;

		const body = await envelope(response);
		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect(body.meta.stale).toBe(true);
		expect(body.data).toEqual(HELD);
		expect(kv.store.get(key)).toBe(before);
	});

	it('does replace a held answer that was not a feed either', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('missing', { status: 404 }))
		);
		const kv = fakeKv();
		const key = await kvKey();
		seed(kv, key, { kind: 'unavailable', reason: 'not-feed' }, 30 * MINUTE);

		const { response, settled } = await call({ kv });
		await settled;

		expect((await envelope(response)).data).toEqual({ kind: 'unavailable', reason: 'gone' });
		expect(JSON.parse(kv.store.get(key) ?? '{}').payload).toEqual({
			kind: 'unavailable',
			reason: 'gone'
		});
	});
});

describe('when the host is down (doc 11 §4)', () => {
	it('serves the held copy as stale', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('busy', { status: 503 }))
		);
		const kv = fakeKv();
		seed(kv, await kvKey(), HELD, 30 * MINUTE);

		const { response } = await call({ kv });

		const body = await envelope(response);
		expect(response.headers.get('x-tp-cache')).toBe('STALE');
		expect(body.meta.stale).toBe(true);
		expect(body.data).toEqual(HELD);
	});

	it('is UPSTREAM_DOWN with nothing held', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('busy', { status: 503 }))
		);

		const { response } = await call();

		expect(response.status).toBe(503);
		expect((await envelope(response)).error?.code).toBe('UPSTREAM_DOWN');
	});

	it("treats the host's 429 as down, never as our own RATE_LIMITED", async () => {
		// Our RATE_LIMITED raises the reader's global notice (doc 17 §5); a busy
		// feed host is not the reader going too fast.
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('slow down', { status: 429 }))
		);

		const { response } = await call();

		expect((await envelope(response)).error?.code).toBe('UPSTREAM_DOWN');
	});

	it('does not serve a copy older than the stale window', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('busy', { status: 503 }))
		);
		const kv = fakeKv();
		seed(kv, await kvKey(), HELD, 25 * 60 * MINUTE);

		const { response } = await call({ kv });

		expect(response.status).toBe(503);
	});
});
