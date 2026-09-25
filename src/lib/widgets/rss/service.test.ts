import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TpApiMeta, TpFeed, TpFeedItem, TpFeedPayload } from '$lib/api-types';
import type { TpSwrFetcher, TpSwrStatus } from '$lib/core/swr.svelte';
import { RATE_LIMIT, ZONE_RATE_LIMIT, cacheKey } from '$lib/shared-constants';
import manifest from './manifest';
import {
	RSS_CADENCE,
	STALE_AFTER_MS,
	addFeed,
	feedInput,
	feedName,
	feedPacer,
	feedRequestUrl,
	feedSource,
	feedView,
	hostOf,
	mergeItems,
	monogramOf,
	moveFeed,
	openableLink,
	readSettings,
	removeFeed,
	rssBadge,
	troubleOf,
	type TpFeedReading,
	type TpFeedView
} from './service';

/**
 * `swr` is replaced by a recorder, so `feedSource` hands back the fetcher it
 * built and the pacing can be driven by hand. Everything else here is pure.
 */
vi.mock('$lib/core/swr.svelte', () => ({
	swr: (key: string, fetcher: TpSwrFetcher<TpFeedReading>, options: { ttlMs: number }) => ({
		key,
		fetcher,
		options
	})
}));

const VNE = 'https://vnexpress.net/rss/tin-moi-nhat.rss';
const BBC = 'https://feeds.bbci.co.uk/news/rss.xml';
const HN = 'https://news.ycombinator.com/rss';

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 8, 25, 9, 0);

function item(id: string, publishedAt: number | null, overrides: Partial<TpFeedItem> = {}) {
	return {
		id,
		title: `Title ${id}`,
		link: `https://example.com/${id}`,
		summaryHtml: '',
		publishedAt,
		author: null,
		...overrides
	} satisfies TpFeedItem;
}

function feed(items: TpFeedItem[], overrides: Partial<TpFeed> = {}): TpFeed {
	return { title: 'A feed', link: null, lang: 'vi', items, ...overrides };
}

function view(url: string, overrides: Partial<TpFeedView> = {}): TpFeedView {
	const shown = overrides.feed !== undefined && overrides.feed !== null;
	return {
		url,
		feed: null,
		unavailable: null,
		shown,
		status: 'fresh',
		servedStale: false,
		fetchedAt: NOW - MINUTE,
		cachedAt: NOW - MINUTE,
		...overrides
	};
}

describe('the manifest (doc 06 §7)', () => {
	it('refreshes on the cadence every feed registers with', () => {
		expect(manifest.refresh).toEqual(RSS_CADENCE);
	});
});

describe('readSettings', () => {
	it('starts empty and never opened', () => {
		expect(readSettings({})).toEqual({ feeds: [], lastOpenedAt: null });
	});

	it('keeps feed URLs this build would send, in their canonical spelling', () => {
		const { feeds } = readSettings({
			feeds: ['https://VNEXPRESS.net/rss/tin-moi-nhat.rss#top', 'http://example.com/feed', 42, BBC]
		});

		expect(feeds).toEqual([VNE, BBC]);
	});

	it('drops a second spelling of a feed it already has', () => {
		expect(
			readSettings({ feeds: [VNE, 'https://vnexpress.net./rss/tin-moi-nhat.rss'] }).feeds
		).toEqual([VNE]);
	});

	it('stops at ten however long a hand-edited layout made the list', () => {
		const many = Array.from({ length: 14 }, (_, i) => `https://example.com/${String(i)}.xml`);

		expect(readSettings({ feeds: many }).feeds).toHaveLength(10);
	});

	it('reads the watermark only when it is a real time', () => {
		expect(readSettings({ lastOpenedAt: NOW }).lastOpenedAt).toBe(NOW);
		for (const bad of [0, -1, Number.NaN, Infinity, '2026-09-25', null]) {
			expect(readSettings({ lastOpenedAt: bad }).lastOpenedAt, String(bad)).toBeNull();
		}
	});
});

describe('adding a feed', () => {
	it('asks a bare host and path over https', () => {
		expect(feedInput('  vnexpress.net/rss/tin-moi-nhat.rss ')).toBe(VNE);
		expect(feedInput('//vnexpress.net/rss/tin-moi-nhat.rss')).toBe(VNE);
	});

	it('asks an http feed over https rather than refusing it (plan S8)', () => {
		expect(feedInput('http://vnexpress.net/rss/tin-moi-nhat.rss')).toBe(VNE);
		expect(feedInput('HTTP://vnexpress.net/rss/tin-moi-nhat.rss')).toBe(VNE);
	});

	it('leaves every other scheme for the guard to refuse', () => {
		expect(feedInput('ftp://example.com/feed')).toBe('ftp://example.com/feed');
		expect(addFeed([], 'ftp://example.com/feed')).toEqual({ ok: false, reason: 'scheme' });
		expect(addFeed([], 'javascript:alert(1)')).toEqual({ ok: false, reason: 'scheme' });
	});

	it('adds the canonical spelling', () => {
		expect(addFeed([BBC], 'vnexpress.net/rss/tin-moi-nhat.rss#x')).toEqual({
			ok: true,
			url: VNE,
			feeds: [BBC, VNE]
		});
	});

	it('refuses a feed it already has, in any spelling', () => {
		expect(addFeed([VNE], 'https://VNEXPRESS.NET/rss/tin-moi-nhat.rss')).toEqual({
			ok: false,
			reason: 'duplicate'
		});
	});

	it('refuses an eleventh feed', () => {
		const ten = Array.from({ length: 10 }, (_, i) => `https://example.com/${String(i)}.xml`);

		expect(addFeed(ten, VNE)).toEqual({ ok: false, reason: 'full' });
	});

	it('says which rule a URL broke', () => {
		expect(addFeed([], '')).toEqual({ ok: false, reason: 'invalid' });
		expect(addFeed([], 'https://127.0.0.1/feed')).toEqual({ ok: false, reason: 'address' });
		expect(addFeed([], 'https://router.lan/feed')).toEqual({ ok: false, reason: 'host' });
	});

	it('refuses the host the app is served from', () => {
		expect(addFeed([], 'https://tp.example.workers.dev/rss', 'tp.example.workers.dev')).toEqual({
			ok: false,
			reason: 'host'
		});
	});

	it('removes and reorders', () => {
		expect(removeFeed([VNE, BBC, HN], BBC)).toEqual([VNE, HN]);
		expect(moveFeed([VNE, BBC, HN], HN, -1)).toEqual([VNE, HN, BBC]);
		expect(moveFeed([VNE, BBC, HN], VNE, 1)).toEqual([BBC, VNE, HN]);
		expect(moveFeed([VNE, BBC], VNE, -1)).toEqual([VNE, BBC]);
		expect(moveFeed([VNE, BBC], BBC, 1)).toEqual([VNE, BBC]);
		expect(moveFeed([VNE], HN, 1)).toEqual([VNE]);
	});
});

describe('the request', () => {
	it('carries exactly the canonical URL, which is all the Worker accepts', () => {
		const request = new URL(feedRequestUrl(`${VNE}?a=1&b=2`), 'https://tilepier.win');

		expect(request.pathname).toBe('/api/rss');
		expect(request.searchParams.getAll('url')).toEqual([`${VNE}?a=1&b=2`]);
	});
});

describe('the source', () => {
	const META: TpApiMeta = { cachedAt: NOW / 1000, source: 'rss', stale: false };
	const PAYLOAD: TpFeedPayload = { kind: 'feed', feed: feed([]) };

	beforeEach(() => {
		vi.useFakeTimers({ now: NOW });
		feedPacer.reset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	function source(url: string) {
		return feedSource(url, 'ab'.repeat(32)) as unknown as {
			key: string;
			fetcher: TpSwrFetcher<TpFeedReading>;
			options: { ttlMs: number };
		};
	}

	function answer(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json', ...headers }
		});
	}

	it('is keyed by the hash, never by the URL', () => {
		// A private feed carries its token in its URL, and the key is what the
		// diagnostics table and the log buffer see.
		const { key } = source(VNE);

		expect(key).toBe(cacheKey.rss('ab'.repeat(32)));
		expect(key).not.toContain('vnexpress');
	});

	it('reads the envelope into a payload and its meta', async () => {
		const fetch = vi.fn(() => Promise.resolve(answer({ ok: true, data: PAYLOAD, meta: META })));
		vi.stubGlobal('fetch', fetch);

		const reading = await source(VNE).fetcher(new AbortController().signal);

		expect(reading).toEqual({ payload: PAYLOAD, meta: META });
		expect(String(fetch.mock.calls[0]?.at(0))).toBe(feedRequestUrl(VNE));
	});

	it('holds every other feed after a 429, for as long as it names', async () => {
		const asked: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn((input: string) => {
				asked.push(input);
				return Promise.resolve(
					asked.length === 1
						? answer({ ok: false, error: { code: 'RATE_LIMITED', retryAfterS: 30 } }, 429)
						: answer({ ok: true, data: PAYLOAD, meta: META })
				);
			})
		);

		await expect(source(VNE).fetcher(new AbortController().signal)).rejects.toMatchObject({
			code: 'RATE_LIMITED'
		});
		const next = source(BBC).fetcher(new AbortController().signal);

		await vi.advanceTimersByTimeAsync(29_999);
		expect(asked).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);
		await next;
		expect(asked).toHaveLength(2);
	});

	it('pauses for one limiter bucket when a 429 names no time', async () => {
		let calls = 0;
		vi.stubGlobal(
			'fetch',
			vi.fn(() => {
				calls += 1;
				return Promise.resolve(
					calls === 1
						? answer({ ok: false, error: { code: 'RATE_LIMITED' } }, 429)
						: answer({ ok: true, data: PAYLOAD, meta: META })
				);
			})
		);

		await source(VNE)
			.fetcher(new AbortController().signal)
			.catch(() => undefined);
		const next = source(BBC).fetcher(new AbortController().signal);

		await vi.advanceTimersByTimeAsync(RATE_LIMIT.bucketMs - 1);
		expect(calls).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		await next;
		expect(calls).toBe(2);
	});

	it('gives the turn back when a request fails', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.reject(new TypeError('offline')))
		);

		for (let i = 0; i < 3; i += 1) {
			const attempt = source(VNE).fetcher(new AbortController().signal);
			await vi.advanceTimersByTimeAsync(1_000);
			await expect(attempt).rejects.toMatchObject({ code: 'NETWORK' });
		}
	});

	it('sends nothing for a feed dropped while it waited', async () => {
		const fetch = vi.fn(() => Promise.resolve(answer({ ok: true, data: PAYLOAD, meta: META })));
		vi.stubGlobal('fetch', fetch);
		feedPacer.pause(10_000);

		const controller = new AbortController();
		const waiting = source(VNE).fetcher(controller.signal);
		controller.abort();

		await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
		await vi.advanceTimersByTimeAsync(10_000);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('takes half of each of doc 11 §7’s windows', async () => {
		// 16 feeds, cold: the sixteenth waits for the 10 s bucket to have room.
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(answer({ ok: true, data: PAYLOAD, meta: META })))
		);
		const started: number[] = [];
		const all = Array.from({ length: RATE_LIMIT.maxPerBucket / 2 + 1 }, (_, i) =>
			source(`https://example.com/${String(i)}.xml`)
				.fetcher(new AbortController().signal)
				.then(() => started.push(Date.now() - NOW))
		);

		await vi.advanceTimersByTimeAsync(RATE_LIMIT.bucketMs + 1_000);
		await Promise.all(all);

		expect(started.slice(0, -1).every((at) => at < RATE_LIMIT.bucketMs)).toBe(true);
		expect(started.at(-1)).toBeGreaterThanOrEqual(RATE_LIMIT.bucketMs);
		expect(ZONE_RATE_LIMIT.maxPerWindow / 2).toBe(30);
	});
});

describe('feedView', () => {
	const META: TpApiMeta = { cachedAt: 1_000, source: 'rss', stale: false };

	function handle(
		payload: TpFeedPayload | undefined,
		status: TpSwrStatus = 'fresh',
		stale = false
	) {
		return {
			data: payload === undefined ? undefined : { payload, meta: { ...META, stale } },
			status,
			cachedAt: payload === undefined ? undefined : 5_000
		};
	}

	it('shows a feed, dated by when the Worker fetched it', () => {
		const shown = feedView(VNE, handle({ kind: 'feed', feed: feed([]) }));

		expect(shown).toMatchObject({ shown: true, fetchedAt: 1_000_000, cachedAt: 5_000 });
		expect(shown.unavailable).toBeNull();
	});

	it('counts a feed with no items as answered', () => {
		// Nothing to list is not a failure; `tileView` must not call it an error.
		expect(feedView(VNE, handle({ kind: 'feed', feed: feed([]) })).shown).toBe(true);
	});

	it('carries the Worker’s answer that a URL is not a feed', () => {
		const answer = feedView(VNE, handle({ kind: 'unavailable', reason: 'not-feed' }));

		expect(answer).toMatchObject({ shown: false, feed: null, unavailable: 'not-feed' });
	});

	it('carries the Worker’s own staleness, which swr cannot see', () => {
		expect(feedView(VNE, handle({ kind: 'feed', feed: feed([]) }, 'fresh', true)).servedStale).toBe(
			true
		);
	});

	it('has nothing before the first answer', () => {
		expect(feedView(VNE, handle(undefined, 'loading'))).toMatchObject({
			shown: false,
			feed: null,
			fetchedAt: undefined
		});
	});
});

describe('names and letters', () => {
	it('names a feed by its title, or by its host without the www', () => {
		expect(feedName({ url: VNE, feed: feed([], { title: ' VnExpress ' }) })).toBe('VnExpress');
		expect(feedName({ url: 'https://www.example.com/feed', feed: feed([], { title: '' }) })).toBe(
			'example.com'
		);
		expect(feedName({ url: VNE, feed: null })).toBe('vnexpress.net');
		expect(hostOf('not a url')).toBe('not a url');
	});

	it('shows a feed by its first letter or digit, in the reader’s case', () => {
		expect(monogramOf('vnexpress.net', 'vi')).toBe('V');
		expect(monogramOf('«Đời sống»', 'vi')).toBe('Đ');
		expect(monogramOf('9to5Mac', 'en')).toBe('9');
		expect(monogramOf('ıstanbul', 'tr')).toBe('I');
		expect(monogramOf('— ', 'en')).toBe('#');
	});

	it('only lets a browser follow http and https', () => {
		expect(openableLink('https://example.com/a')).toBe('https://example.com/a');
		expect(openableLink('http://example.com/a')).toBe('http://example.com/a');
		for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'relative/path', null]) {
			expect(openableLink(bad), String(bad)).toBeNull();
		}
	});
});

describe('the merged list (doc 08 §4)', () => {
	it('interleaves every feed newest first', () => {
		const list = mergeItems(
			[
				view(VNE, { feed: feed([item('v1', NOW - 5 * MINUTE), item('v2', NOW - 30 * MINUTE)]) }),
				view(BBC, { feed: feed([item('b1', NOW - 10 * MINUTE)]) })
			],
			null,
			50
		);

		expect(list.map((entry) => entry.item.id)).toEqual(['v1', 'b1', 'v2']);
	});

	it('orders an undated item by when its feed was fetched, and tags it', () => {
		const list = mergeItems(
			[
				view(VNE, { feed: feed([item('v1', NOW - 20 * MINUTE)]) }),
				view(HN, { feed: feed([item('h1', null)]), fetchedAt: NOW - 10 * MINUTE })
			],
			null,
			50
		);

		expect(list.map((entry) => [entry.item.id, entry.dated, entry.at])).toEqual([
			['h1', false, NOW - 10 * MINUTE],
			['v1', true, NOW - 20 * MINUTE]
		]);
	});

	it('reads a date in the future as the fetch time', () => {
		const list = mergeItems(
			[view(VNE, { feed: feed([item('v1', NOW + 60 * MINUTE)]), fetchedAt: NOW - MINUTE })],
			NOW,
			50
		);

		expect(list[0]?.at).toBe(NOW - MINUTE);
		// …so opening the tile marks it read, instead of it staying new forever.
		expect(list[0]?.unread).toBe(false);
	});

	it('marks dated items newer than the watermark unread, and nothing else', () => {
		const list = mergeItems(
			[
				view(VNE, {
					feed: feed([item('new', NOW - MINUTE), item('old', NOW - 60 * MINUTE), item('nd', null)])
				})
			],
			NOW - 30 * MINUTE,
			50
		);

		expect(Object.fromEntries(list.map((entry) => [entry.item.id, entry.unread]))).toEqual({
			new: true,
			old: false,
			// Undated is never unread: it would come back as new on every refetch.
			nd: false
		});
	});

	it('marks nothing unread without a watermark', () => {
		const list = mergeItems([view(VNE, { feed: feed([item('v1', NOW)]) })], null, 50);

		expect(list[0]?.unread).toBe(false);
	});

	it('lists an article two feeds share once, under the first feed', () => {
		const shared = { link: 'https://example.com/story' };
		const list = mergeItems(
			[
				view(VNE, { feed: feed([item('a', NOW - 2 * MINUTE, shared)]) }),
				view(BBC, { feed: feed([item('b', NOW - 2 * MINUTE, shared), item('c', NOW - MINUTE)]) })
			],
			null,
			50
		);

		expect(list.map((entry) => entry.key)).toEqual([`${BBC}\nc`, `${VNE}\na`]);
	});

	it('keeps two feeds’ items apart when they share an id', () => {
		const list = mergeItems(
			[
				view(VNE, { feed: feed([item('1', NOW, { link: null })]) }),
				view(BBC, { feed: feed([item('1', NOW, { link: null })]) })
			],
			null,
			50
		);

		expect(new Set(list.map((entry) => entry.key)).size).toBe(2);
	});

	it('breaks ties by feed order, then by each feed’s own order', () => {
		const list = mergeItems(
			[
				view(VNE, { feed: feed([item('v1', null), item('v2', null)]), fetchedAt: NOW }),
				view(BBC, { feed: feed([item('b1', null)]), fetchedAt: NOW })
			],
			null,
			50
		);

		expect(list.map((entry) => entry.item.id)).toEqual(['v1', 'v2', 'b1']);
	});

	it('stops at the limit', () => {
		const items = Array.from({ length: 30 }, (_, i) => item(String(i), NOW - i * MINUTE));

		expect(mergeItems([view(VNE, { feed: feed(items) })], null, 12)).toHaveLength(12);
	});

	it('carries what each line needs', () => {
		const [entry] = mergeItems(
			[
				view(VNE, {
					feed: feed([item('v1', NOW, { link: 'javascript:alert(1)' })], {
						title: 'VnExpress',
						lang: 'vi-VN'
					})
				}),
				view(BBC, { feed: null, unavailable: 'not-feed' })
			],
			null,
			50
		);

		expect(entry).toMatchObject({ feedUrl: VNE, feedName: 'VnExpress', lang: 'vi-VN', link: null });
	});

	it('leaves the language unknown rather than claiming the page’s', () => {
		const [entry] = mergeItems(
			[view(VNE, { feed: feed([item('v1', NOW)], { lang: null }) })],
			null,
			50
		);

		expect(entry?.lang).toBe('');
	});
});

describe('per-feed trouble (doc 08 §4)', () => {
	it('names the Worker’s answer that a URL is not a feed', () => {
		expect(troubleOf(view(VNE, { unavailable: 'gone' }))).toEqual({
			kind: 'unavailable',
			reason: 'gone'
		});
	});

	it('says a feed with nothing on screen failed, whatever the failure was', () => {
		for (const status of ['error', 'offline', 'rate-limited'] as const) {
			expect(troubleOf(view(VNE, { status })), status).toEqual({ kind: 'failed' });
		}
	});

	it('says nothing about a feed still on its way', () => {
		expect(troubleOf(view(VNE, { status: 'loading' }))).toBeNull();
		expect(troubleOf(view(VNE, { status: 'idle' }))).toBeNull();
	});

	it('says a feed on screen is behind when it could not be refreshed', () => {
		for (const status of ['stale-error', 'rate-limited', 'error'] as const) {
			expect(troubleOf(view(VNE, { feed: feed([]), status })), status).toEqual({
				kind: 'behind',
				since: NOW - MINUTE
			});
		}
	});

	it('says a feed is behind when the Worker served its held copy', () => {
		expect(troubleOf(view(VNE, { feed: feed([]), servedStale: true }))).toMatchObject({
			kind: 'behind'
		});
	});

	it('has nothing to say about a current feed', () => {
		expect(troubleOf(view(VNE, { feed: feed([]) }))).toBeNull();
		expect(troubleOf(view(VNE, { feed: feed([]), status: 'stale' }))).toBeNull();
	});
});

describe('the host badge (doc 13 §7, rss rule)', () => {
	const shown = (overrides: Partial<TpFeedView> = {}) => ({ feed: feed([]), ...overrides });

	it('does not let one flaky feed in several hang stale-error over the tile', () => {
		const views = [
			view(VNE, shown({ status: 'stale-error' })),
			view(BBC, shown()),
			view(HN, shown())
		];

		expect(rssBadge(views, NOW)).toBeNull();
	});

	it('raises stale-error when every feed on screen failed its refresh, dated by the oldest', () => {
		const views = [
			view(VNE, shown({ status: 'stale-error', cachedAt: NOW - 30 * MINUTE })),
			view(BBC, shown({ status: 'rate-limited', cachedAt: NOW - 50 * MINUTE })),
			// Not on screen, so not part of the claim.
			view(HN, { status: 'error' })
		];

		expect(rssBadge(views, NOW)).toEqual({ kind: 'stale-error', at: NOW - 50 * MINUTE });
	});

	it('raises offline as soon as any feed on screen found the network gone', () => {
		const views = [view(VNE, shown({ status: 'offline' })), view(BBC, shown())];

		expect(rssBadge(views, NOW)).toEqual({ kind: 'offline', at: undefined });
	});

	it('raises stale only when every feed on screen has missed a whole refresh', () => {
		const old = NOW - STALE_AFTER_MS - 1;

		expect(
			rssBadge([view(VNE, shown({ cachedAt: old })), view(BBC, shown({ cachedAt: old - 1 }))], NOW)
		).toEqual({ kind: 'stale', at: old - 1 });
		expect(
			rssBadge([view(VNE, shown({ cachedAt: old })), view(BBC, shown({ cachedAt: NOW }))], NOW)
		).toBeNull();
	});

	it('does not flash stale at every refresh', () => {
		// swr's own `stale` starts the moment an entry passes its window, which
		// is every cycle here. The badge waits for a cycle to be missed.
		const due = view(VNE, shown({ status: 'stale', cachedAt: NOW - RSS_CADENCE.everyMs - 1 }));

		expect(rssBadge([due], NOW)).toBeNull();
	});

	it('leaves a tile with nothing on screen to its own view', () => {
		expect(rssBadge([view(VNE, { status: 'offline' })], NOW)).toBeNull();
		expect(rssBadge([], NOW)).toBeNull();
	});
});
