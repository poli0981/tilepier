import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { TpFeed, TpFeedItem, TpFeedPayload } from '$lib/api-types';
import { scheduler } from '$lib/core/scheduler';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { swrCache } from '$lib/core/swr.svelte';
import { tileStatusChannel } from '$lib/core/tile-status';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { feedPacer } from './service';
import TpRssDetail from './TpRssDetail.svelte';

/**
 * The rss detail in the browser project, with the tile's harness: `fetch`
 * answering per feed, a held clock, a throwaway Dexie per case.
 */

const NOW = Date.UTC(2026, 8, 25, 9, 0);
const MINUTE = 60_000;

const VNE = 'https://vnexpress.net/rss/tin-moi-nhat.rss';
const BBC = 'https://feeds.bbci.co.uk/news/rss.xml';

let db: TpDb;

function item(id: string, publishedAt: number | null, overrides: Partial<TpFeedItem> = {}) {
	return {
		id,
		title: `Story ${id}`,
		link: `https://example.com/${id}`,
		summaryHtml: `<p>Summary of ${id}</p>`,
		publishedAt,
		author: null,
		...overrides
	} satisfies TpFeedItem;
}

function feed(title: string, items: TpFeedItem[], lang = 'vi'): TpFeed {
	return { title, link: null, lang, items };
}

function ok(payload: TpFeedPayload) {
	return { ok: true, data: payload, meta: { cachedAt: NOW / 1000, source: 'rss', stale: false } };
}

function serveFeeds(answers: Record<string, unknown>): ReturnType<typeof vi.fn> {
	const spy = vi.fn(async (input: string) => {
		const url = new URL(input, location.origin).searchParams.get('url') ?? '';
		const answer = answers[url] as { ok: boolean } | undefined;
		if (answer === undefined) throw new TypeError('Failed to fetch');
		return new Response(JSON.stringify(answer), {
			status: answer.ok ? 200 : 503,
			headers: { 'content-type': 'application/json' }
		});
	});
	vi.stubGlobal('fetch', spy);
	return spy;
}

const VNE_FEED = feed('VnExpress', [
	item('v-new', NOW - 5 * MINUTE, { author: 'Ngọc Anh' }),
	item('v-old', NOW - 90 * MINUTE, { summaryHtml: '' })
]);
const BBC_FEED = feed(
	'BBC News',
	[
		item('b-mid', NOW - 20 * MINUTE, {
			summaryHtml:
				'<p>Before<img src="https://tracker.example/p.gif" onerror="alert(1)"><script>alert(2)</script> <a href="/relative">after</a> <a href="https://bbc.co.uk/x">link</a></p>'
		})
	],
	'en-GB'
);

function props(over: Record<string, unknown> = {}) {
	return {
		instanceId: 'wgt_rss',
		settings: { feeds: [VNE, BBC], lastOpenedAt: NOW - 30 * MINUTE },
		close: () => undefined,
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
	db = createDb(`tilepier-rssd-${crypto.randomUUID()}`);
});

afterEach(async () => {
	cleanup();
	scheduler.reset();
	swrCache.reset();
	online.reset();
	feedPacer.reset();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.useRealTimers();
	vi.restoreAllMocks();
	db.close();
	await db.delete();
});

async function ready(screen: ReturnType<typeof render>) {
	await expect.element(screen.getByText('Story v-new')).toBeInTheDocument();
	await expect.element(screen.getByText('Story b-mid')).toBeInTheDocument();
}

describe('opening it (doc 08 §4)', () => {
	it('moves the watermark to now, and still marks what was new when it opened', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const onUpdateSettings = vi.fn();
		const screen = render(TpRssDetail, props({ onUpdateSettings }));

		expect(onUpdateSettings).toHaveBeenCalledOnce();
		const written = onUpdateSettings.mock.calls[0]?.[0] as { lastOpenedAt: number };
		expect(written.lastOpenedAt).toBeGreaterThanOrEqual(NOW);

		await ready(screen);
		const dotted = [...document.querySelectorAll('.tp-rssd__story')]
			.filter((story) => story.querySelector('.tp-rssd__dot') !== null)
			.map((story) => story.querySelector('.tp-rssd__story-title')?.textContent);
		expect(dotted).toEqual(['Story v-new', 'Story b-mid']);
	});

	it('writes nothing for a tile with no feeds', () => {
		serveFeeds({});
		const onUpdateSettings = vi.fn();
		render(TpRssDetail, props({ settings: {}, onUpdateSettings }));

		expect(onUpdateSettings).not.toHaveBeenCalled();
	});
});

describe('the list and the filter', () => {
	it('merges every feed, and shows one feed alone when it is picked', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssDetail, props());
		await ready(screen);

		await screen.getByRole('button', { name: 'BBC News', exact: true }).click();

		await expect.element(screen.getByText('Story v-new')).not.toBeInTheDocument();
		await expect.element(screen.getByText('Story b-mid')).toBeInTheDocument();

		await screen.getByRole('button', { name: m['widget.rss.all_feeds']() }).click();
		await expect.element(screen.getByText('Story v-new')).toBeInTheDocument();
	});
});

describe('the reader', () => {
	it('shows the story, its feed and author, and opens the original as the primary action', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssDetail, props());
		await ready(screen);

		await screen.getByRole('button', { name: /Story v-new/ }).click();

		const reader = screen.getByTestId('rssd-reader');
		await expect.element(reader.getByRole('heading', { name: 'Story v-new' })).toBeInTheDocument();
		await expect.element(reader.getByText('Ngọc Anh')).toBeInTheDocument();
		const open = screen.getByTestId('rssd-open');
		await expect.element(open).toHaveAttribute('href', 'https://example.com/v-new');
		await expect.element(open).toHaveAttribute('target', '_blank');
		await expect.element(open).toHaveAttribute('rel', 'noopener noreferrer');
		await expect.element(reader.getByText('Summary of v-new')).toBeInTheDocument();
	});

	it('renders a stranger’s summary through the RSS profile: no image, no script, no relative link', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssDetail, props());
		await ready(screen);

		await screen.getByRole('button', { name: /Story b-mid/ }).click();

		const summary = screen.getByTestId('feed-html');
		await expect.element(summary).toHaveTextContent('Before');
		const html = summary.element().innerHTML;
		expect(html).not.toMatch(/<img|<script|onerror|tracker\.example|\/relative/);
		expect(html).toContain('href="https://bbc.co.uk/x"');
		expect(html).toContain('rel="noopener noreferrer"');
		// doc 14: the feed's language on the stranger's text.
		await expect.element(summary).toHaveAttribute('lang', 'en-GB');
	});

	it('says so when a feed gives no summary', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const screen = render(TpRssDetail, props());
		await ready(screen);

		await screen.getByRole('button', { name: /Story v-old/ }).click();

		await expect.element(screen.getByText(m['widget.rss.no_summary']())).toBeInTheDocument();
	});
});

describe('the feed manager', () => {
	it('removes a feed', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const onUpdateSettings = vi.fn();
		const screen = render(TpRssDetail, props({ onUpdateSettings }));
		await ready(screen);

		await screen
			.getByRole('button', { name: m['widget.rss.remove_feed']({ feed: 'VnExpress' }) })
			.click();

		expect(onUpdateSettings).toHaveBeenLastCalledWith({ feeds: [BBC] });
	});

	it('reorders, and cannot move a feed off either end', async () => {
		serveFeeds({
			[VNE]: ok({ kind: 'feed', feed: VNE_FEED }),
			[BBC]: ok({ kind: 'feed', feed: BBC_FEED })
		});
		const onUpdateSettings = vi.fn();
		const screen = render(TpRssDetail, props({ onUpdateSettings }));
		await ready(screen);

		await expect
			.element(screen.getByRole('button', { name: m['widget.rss.move_up']({ feed: 'VnExpress' }) }))
			.toBeDisabled();
		await screen
			.getByRole('button', { name: m['widget.rss.move_up']({ feed: 'BBC News' }) })
			.click();

		expect(onUpdateSettings).toHaveBeenLastCalledWith({ feeds: [BBC, VNE] });
	});

	it('adds a feed through the same box as the tile', async () => {
		serveFeeds({ [VNE]: ok({ kind: 'feed', feed: VNE_FEED }) });
		const onUpdateSettings = vi.fn();
		const screen = render(
			TpRssDetail,
			props({ settings: { feeds: [VNE], lastOpenedAt: NOW - MINUTE }, onUpdateSettings })
		);

		await screen.getByTestId('rss-add-input').fill('feeds.bbci.co.uk/news/rss.xml');
		await screen.getByTestId('rss-add').click();

		expect(onUpdateSettings).toHaveBeenLastCalledWith({
			feeds: [VNE, BBC],
			lastOpenedAt: NOW - MINUTE
		});
	});

	it('marks a feed with a problem, and offers a retry only where one can help', async () => {
		serveFeeds({
			[VNE]: { ok: false, error: { code: 'UPSTREAM_DOWN' } },
			[BBC]: ok({ kind: 'unavailable', reason: 'not-feed' })
		});
		const screen = render(TpRssDetail, props());

		await expect.element(screen.getByText(m['widget.rss.trouble_not_feed']())).toBeInTheDocument();
		await expect.element(screen.getByText(m['widget.rss.trouble_failed']())).toBeInTheDocument();
		// A failure can pass; an answer that the URL is not a feed will not.
		await expect
			.element(
				screen.getByRole('button', { name: m['widget.rss.retry_feed']({ feed: 'vnexpress.net' }) })
			)
			.toBeInTheDocument();
		expect(
			screen
				.getByRole('button', { name: m['widget.rss.retry_feed']({ feed: 'feeds.bbci.co.uk' }) })
				.query()
		).toBeNull();
	});
});
