import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { TpFeed, TpFeedItem, TpFeedPayload } from '$lib/api-types';
import { readLog } from '$lib/core/log-buffer';
import { scheduler } from '$lib/core/scheduler';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { swrCache } from '$lib/core/swr.svelte';
import { tileStatus, tileStatusChannel } from '$lib/core/tile-status';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { cacheKey, feedUrlHash } from '$lib/shared-constants';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { RSS_CADENCE, feedPacer } from './service';
import TpRssWidget from './TpRssWidget.svelte';

/**
 * The rss tile, in the browser project: `fetch` answers per feed URL, the clock
 * is held, and every case gets a throwaway Dexie — the pattern of the other
 * networked tiles. Message assertions go through `m[...]()`.
 */

const NOW = Date.UTC(2026, 8, 25, 9, 0);
const MINUTE = 60_000;

const VNE = 'https://vnexpress.net/rss/tin-moi-nhat.rss';
const BBC = 'https://feeds.bbci.co.uk/news/rss.xml';
/** A private feed: the token in its URL must never reach the log buffer. */
const PRIVATE = 'https://example.org/feed?token=s3cr3t-t0ken';

const M: TpTileSize = { w: 3, h: 4, pxW: 320, pxH: 300, tier: 'M' };
const L: TpTileSize = { w: 4, h: 5, pxW: 440, pxH: 380, tier: 'L' };

let db: TpDb;

function item(id: string, publishedAt: number | null, overrides: Partial<TpFeedItem> = {}) {
	return {
		id,
		title: `Story ${id}`,
		link: `https://example.com/${id}`,
		summaryHtml: '<p>summary</p>',
		publishedAt,
		author: null,
		...overrides
	} satisfies TpFeedItem;
}

function feed(title: string, items: TpFeedItem[]): TpFeed {
	return { title, link: null, lang: 'vi', items };
}

function ok(payload: TpFeedPayload, stale = false) {
	return { ok: true, data: payload, meta: { cachedAt: NOW / 1000, source: 'rss', stale } };
}

type Answer = ReturnType<typeof ok> | { ok: false; error: { code: string } } | 'network' | 'hang';

/** Answers `/api/rss` by the feed each request names. */
function serveFeeds(answers: Record<string, Answer>): ReturnType<typeof vi.fn> {
	const spy = vi.fn(async (input: string) => {
		const url = new URL(input, location.origin).searchParams.get('url') ?? '';
		const answer = answers[url];
		if (answer === undefined || answer === 'network') throw new TypeError('Failed to fetch');
		if (answer === 'hang') return new Promise<Response>(() => undefined);
		return new Response(JSON.stringify(answer), {
			status: answer.ok ? 200 : 503,
			headers: { 'content-type': 'application/json' }
		});
	});
	vi.stubGlobal('fetch', spy);
	return spy;
}

/** What `swr` would have left in Dexie from an earlier visit. */
async function seed(url: string, payload: TpFeedPayload, cachedAt: number): Promise<void> {
	await db.apiCache.put({
		key: cacheKey.rss(await feedUrlHash(url)),
		cachedAt,
		payload: { payload, meta: { cachedAt: cachedAt / 1000, source: 'rss', stale: false } }
	});
}

function props(over: Record<string, unknown> = {}) {
	return {
		instanceId: 'wgt_rss',
		settings: { feeds: [VNE, BBC], lastOpenedAt: NOW - 30 * MINUTE },
		size: M,
		db,
		...over
	};
}

beforeEach(() => {
	vi.useFakeTimers({ shouldAdvanceTime: true });
	vi.setSystemTime(NOW);
	settings.dispose();
	settings.hydrate();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	feedPacer.reset();
	tileStatusChannel.clear();
	db = createDb(`tilepier-rss-${crypto.randomUUID()}`);
});

afterEach(async () => {
	cleanup();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	feedPacer.reset();
	tileStatusChannel.clear();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
	db.close();
	await db.delete();
});

const VNE_FEED = feed('VnExpress', [
	item('v-new', NOW - 5 * MINUTE),
	item('v-old', NOW - 90 * MINUTE),
	item('v-undated', null)
]);
const BBC_FEED = feed('BBC News', [item('b-mid', NOW - 20 * MINUTE)]);

describe('the merged list (doc 08 §4)', () => {
	it('lists every feed’s items as one, newest first', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssWidget, props());

		await expect.element(screen.getByText('Story b-mid')).toBeInTheDocument();
		const titles = [...document.querySelectorAll('.tp-rss-item__title')].map(
			(node) => node.textContent
		);
		// The undated item sorts at its feed's fetch time — the newest of all.
		expect(titles).toEqual(['Story v-undated', 'Story v-new', 'Story b-mid', 'Story v-old']);
	});

	it('dots what arrived since the detail was last opened, and nothing undated', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssWidget, props());

		// Both feeds: the second arrives half a second after the first (the pacer).
		await expect.element(screen.getByText('Story v-old')).toBeInTheDocument();
		await expect.element(screen.getByText('Story b-mid')).toBeInTheDocument();
		const dotted = [...document.querySelectorAll('.tp-rss-item')]
			.filter((row) => row.querySelector('.tp-rss-item__dot') !== null)
			.map((row) => row.querySelector('.tp-rss-item__title')?.textContent);
		expect(dotted).toEqual(['Story v-new', 'Story b-mid']);
		await expect
			.element(screen.getByText(m['widget.rss.undated'](), { exact: true }))
			.toBeInTheDocument();
	});

	it('opens a story in a new tab with no way back to the deck', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssWidget, props());

		const link = screen.getByRole('link', { name: 'Story v-new' });
		await expect.element(link).toHaveAttribute('href', 'https://example.com/v-new');
		await expect.element(link).toHaveAttribute('target', '_blank');
		await expect.element(link).toHaveAttribute('rel', 'noopener noreferrer');
		// doc 14: the feed's language, not the page's.
		await expect.element(link).toHaveAttribute('lang', 'vi');
	});

	it('never turns a script URL into a link', async () => {
		const hostile = feed('X', [item('x', NOW - MINUTE, { link: 'javascript:alert(1)' })]);
		serveFeeds({ [VNE]: ok({ kind: 'feed', feed: hostile }) });
		const screen = render(TpRssWidget, props({ settings: { feeds: [VNE] } }));

		await expect.element(screen.getByText('Story x')).toBeInTheDocument();
		expect(document.querySelector('a[href^="javascript"]')).toBeNull();
	});

	it('names each line’s feed at tier L, and leaves it to the letter below that', async () => {
		serveFeeds({ [VNE]: ok({ kind: 'feed', feed: VNE_FEED }) });
		const screen = render(TpRssWidget, props({ settings: { feeds: [VNE] }, size: L }));

		await expect.element(screen.getByText('Story v-new')).toBeInTheDocument();
		expect(document.querySelectorAll('.tp-rss-item__source')).toHaveLength(3);
		expect(document.querySelector('.tp-rss-mono')?.textContent).toBe('V');
	});

	it('says there is nothing to read when every feed is empty', async () => {
		serveFeeds({ [VNE]: ok({ kind: 'feed', feed: feed('VnExpress', []) }) });
		const screen = render(TpRssWidget, props({ settings: { feeds: [VNE] } }));

		await expect.element(screen.getByText(m['widget.rss.nothing_yet']())).toBeInTheDocument();
	});
});

describe('a feed with a problem (doc 08 §4)', () => {
	it('keeps the other feeds working and puts the dead one on a chip', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'unavailable', reason: 'not-feed' })
		});
		const screen = render(TpRssWidget, props());

		await expect.element(screen.getByText('Story v-new')).toBeInTheDocument();
		await expect
			.element(
				screen.getByRole('button', {
					name: m['widget.rss.trouble_label']({
						feed: 'feeds.bbci.co.uk',
						problem: m['widget.rss.trouble_not_feed']()
					})
				})
			)
			.toBeInTheDocument();
		// One feed's trouble is its chip's, not the tile's header.
		expect(tileStatus('wgt_rss')).toBeUndefined();
	});

	it('opens the detail from a chip', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'unavailable', reason: 'gone' })
		});
		const onOpenDetail = vi.fn();
		const screen = render(TpRssWidget, props({ onOpenDetail }));

		await screen.getByTestId('rss-chips').getByRole('button').click();

		expect(onOpenDetail).toHaveBeenCalledOnce();
	});

	it('gives every feed’s reasons, not a retry, when no address is a feed', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'unavailable', reason: 'not-feed' }),
			[BBC]: ok({ kind: 'unavailable', reason: 'too-large' })
		});
		const screen = render(TpRssWidget, props({ onOpenDetail: vi.fn() }));

		await expect.element(screen.getByText(m['widget.rss.nothing_readable']())).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: m['widget.rss.manage']() }))
			.toBeInTheDocument();
		expect(screen.getByRole('button', { name: m['common.retry']() }).query()).toBeNull();
	});
});

describe('states (doc 06 §3)', () => {
	it('holds a skeleton, never a spinner, while nothing has answered', async () => {
		serveFeeds({ [VNE]: 'hang', [BBC]: 'hang' });
		const screen = render(TpRssWidget, props());

		await expect.element(screen.getByLabelText(m['widget.rss.loading']())).toBeInTheDocument();
	});

	it('fails inline with a retry when no feed could be read', async () => {
		const error = { ok: false as const, error: { code: 'UPSTREAM_DOWN' } };
		const spy = serveFeeds({ [VNE]: error, [BBC]: error });
		const screen = render(TpRssWidget, props());

		await expect.element(screen.getByText(m['widget.rss.error']())).toBeInTheDocument();
		const calls = spy.mock.calls.length;
		await screen.getByRole('button', { name: m['common.retry']() }).click();
		await vi.waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(calls));
	});

	it('says offline when the network is gone and nothing was saved', async () => {
		serveFeeds({ [VNE]: 'network', [BBC]: 'network' });
		const screen = render(TpRssWidget, props());

		await expect.element(screen.getByText(m['widget.rss.offline']())).toBeInTheDocument();
	});

	it('raises stale-error on the header only when every feed on screen failed to refresh', async () => {
		await seed(VNE, { kind: 'feed', feed: VNE_FEED }, NOW - 30 * MINUTE);
		await seed(BBC, { kind: 'feed', feed: BBC_FEED }, NOW - 30 * MINUTE);
		const error = { ok: false as const, error: { code: 'UPSTREAM_DOWN' } };
		serveFeeds({ [VNE]: error, [BBC]: error });
		const screen = render(TpRssWidget, props());

		await expect.element(screen.getByText('Story v-new')).toBeInTheDocument();
		await vi.waitFor(() => expect(tileStatus('wgt_rss')?.kind).toBe('stale-error'));
		expect(tileStatus('wgt_rss')?.retry).toBeTypeOf('function');
	});

	it('leaves the header alone when one feed of two failed to refresh', async () => {
		await seed(VNE, { kind: 'feed', feed: VNE_FEED }, NOW - 30 * MINUTE);
		await seed(BBC, { kind: 'feed', feed: BBC_FEED }, NOW - 30 * MINUTE);
		serveFeeds({
			[VNE]: { ok: false, error: { code: 'UPSTREAM_DOWN' } },
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssWidget, props());

		await expect.element(screen.getByTestId('rss-chips')).toBeInTheDocument();
		expect(tileStatus('wgt_rss')).toBeUndefined();
	});

	it('clears its header status on unmount', async () => {
		await seed(VNE, { kind: 'feed', feed: VNE_FEED }, NOW - 30 * MINUTE);
		serveFeeds({ [VNE]: { ok: false, error: { code: 'UPSTREAM_DOWN' } } });
		render(TpRssWidget, props({ settings: { feeds: [VNE] } }));
		await vi.waitFor(() => expect(tileStatus('wgt_rss')?.kind).toBe('stale-error'));

		cleanup();

		expect(tileStatusChannel.size).toBe(0);
	});
});

describe('the first feed (the empty state)', () => {
	it('asks for a feed address, and nothing else', async () => {
		const spy = serveFeeds({});
		const screen = render(TpRssWidget, props({ settings: {} }));

		await expect.element(screen.getByText(m['widget.rss.no_feeds']())).toBeInTheDocument();
		expect(spy).not.toHaveBeenCalled();
	});

	it('adds what was pasted, in the spelling the Worker insists on', async () => {
		serveFeeds({});
		const onUpdateSettings = vi.fn();
		const screen = render(TpRssWidget, props({ settings: {}, onUpdateSettings }));

		await screen.getByTestId('rss-add-input').fill('http://vnexpress.net/rss/tin-moi-nhat.rss');
		await screen.getByTestId('rss-add').click();

		// The watermark starts with the first feed, so its back catalogue does not
		// all arrive unread.
		expect(onUpdateSettings).toHaveBeenCalledOnce();
		const saved = onUpdateSettings.mock.calls[0]?.[0] as { feeds: string[]; lastOpenedAt: number };
		expect(saved.feeds).toEqual([VNE]);
		// The clock runs on under `shouldAdvanceTime`, so "now" is a window.
		expect(saved.lastOpenedAt).toBeGreaterThanOrEqual(NOW);
		expect(saved.lastOpenedAt).toBeLessThan(NOW + MINUTE);
	});

	it('says which rule an address broke, and adds nothing', async () => {
		serveFeeds({});
		const onUpdateSettings = vi.fn();
		const screen = render(TpRssWidget, props({ settings: {}, onUpdateSettings }));

		await screen.getByTestId('rss-add-input').fill('https://192.168.1.1/feed');
		await screen.getByTestId('rss-add').click();

		await expect
			.element(screen.getByRole('alert'))
			.toHaveTextContent(m['widget.rss.refused_address']());
		expect(onUpdateSettings).not.toHaveBeenCalled();
	});
});

describe('refresh and lifetime', () => {
	it('registers each feed under this tile, by hash', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssWidget, props());
		await expect.element(screen.getByText('Story b-mid')).toBeInTheDocument();

		const ids = scheduler.inspect().map((task) => task.id);
		expect(ids.sort()).toEqual(
			[`wgt_rss:rss:${await feedUrlHash(VNE)}`, `wgt_rss:rss:${await feedUrlHash(BBC)}`].sort()
		);
	});

	it('drops a feed’s subscription and refresh with the feed, and leaves the other alone', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssWidget, props());
		await expect.element(screen.getByText('Story b-mid')).toBeInTheDocument();

		await screen.rerender(props({ settings: { feeds: [VNE], lastOpenedAt: NOW - 30 * MINUTE } }));

		await vi.waitFor(() => expect(scheduler.size).toBe(1));
		expect(swrCache.size).toBe(1);
		await expect.element(screen.getByText('Story b-mid')).not.toBeInTheDocument();
		await expect.element(screen.getByText('Story v-new')).toBeInTheDocument();
	});

	it('keeps refreshing a feed on the second of two tiles after the first is removed', async () => {
		// Plan S12, and the bug #21 fixed for weather: nothing about one tile's
		// refresh may depend on another tile's registration.
		const spy = serveFeeds({ [VNE]: ok({ kind: 'feed', feed: VNE_FEED }) });
		const a = render(TpRssWidget, props({ instanceId: 'wgt_a', settings: { feeds: [VNE] } }));
		render(TpRssWidget, props({ instanceId: 'wgt_b', settings: { feeds: [VNE] } }));
		await vi.waitFor(() => expect(document.querySelectorAll('.tp-rss-list')).toHaveLength(2));
		expect(spy).toHaveBeenCalledTimes(1);

		a.unmount();
		expect(scheduler.size).toBe(1);

		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
		scheduler.tick(Date.now() + RSS_CADENCE.everyMs + 1_000);

		await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
	});

	it('leaves nothing behind on unmount', async () => {
		serveFeeds({ [VNE]: ok({ kind: 'feed', feed: VNE_FEED }) });
		const screen = render(TpRssWidget, props({ settings: { feeds: [VNE] } }));
		await expect.element(screen.getByText('Story v-new')).toBeInTheDocument();

		cleanup();

		expect(scheduler.size).toBe(0);
		expect(swrCache.size).toBe(0);
	});

	it('never writes a feed URL to the log, which rides along with a bug report', async () => {
		// BAD_REQUEST is the one failure `swr` logs loudly (doc 17 §4).
		serveFeeds({ [PRIVATE]: { ok: false, error: { code: 'BAD_REQUEST' } } });
		const screen = render(TpRssWidget, props({ settings: { feeds: [PRIVATE] } }));

		await expect.element(screen.getByText(m['widget.rss.error']())).toBeInTheDocument();
		const log = JSON.stringify(readLog());
		expect(log).toContain('rss:v1:');
		expect(log).not.toContain('s3cr3t-t0ken');
		expect(log).not.toContain('example.org');
	});
});
