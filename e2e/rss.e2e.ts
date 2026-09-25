import { expect, test, type Page, type Route } from '@playwright/test';
import { acceptGate } from './_lib/gate';
import { seedLayout } from './_lib/seed';

/**
 * The rss widget end to end, on the built app under its real CSP (doc 08 §4,
 * doc 15 §4).
 *
 * `/api/rss` is answered by `page.route`, as journey #3 answers the weather:
 * the service worker passes `/api/*` straight through, so the page's own
 * requests are what Playwright sees. Every date is built from the real clock,
 * because the app reads the real clock too.
 */

const GOOD = 'https://vnexpress.net/rss/tin-moi-nhat.rss';
const DEAD = 'https://example.org/not-a-feed';
const MINUTE = 60_000;

function feedAnswer(now: number) {
	return {
		ok: true,
		data: {
			kind: 'feed',
			feed: {
				title: 'VnExpress',
				link: 'https://vnexpress.net',
				lang: 'vi',
				items: [
					{
						id: 'a',
						title: 'Tin mới nhất',
						link: 'https://vnexpress.net/a',
						// A stranger's HTML: a tracking pixel, an inline handler and a
						// script, beside the words the reader came for.
						summaryHtml:
							'<p>Mở đầu<img src="https://tracker.example/p.gif" onerror="alert(1)"><script>alert(2)</script> <a href="https://vnexpress.net/b">đọc thêm</a></p>',
						publishedAt: now - 5 * MINUTE,
						author: null
					},
					{
						id: 'old',
						title: 'Tin cũ hơn',
						link: 'https://vnexpress.net/old',
						summaryHtml: '',
						publishedAt: now - 5 * 60 * MINUTE,
						author: null
					}
				]
			}
		},
		meta: { cachedAt: Math.floor(now / 1000), source: 'rss', stale: false }
	};
}

async function answerFeeds(page: Page, now: number): Promise<string[]> {
	const asked: string[] = [];
	await page.route('**/api/rss*', async (route: Route) => {
		const url = new URL(route.request().url()).searchParams.get('url') ?? '';
		asked.push(url);
		if (url === GOOD) {
			await route.fulfill({ json: feedAnswer(now) });
			return;
		}
		await route.fulfill({
			json: {
				ok: true,
				data: { kind: 'unavailable', reason: 'not-feed' },
				meta: { cachedAt: Math.floor(now / 1000), source: 'rss', stale: false }
			}
		});
	});
	return asked;
}

async function seedRss(page: Page, settings: Record<string, unknown>): Promise<void> {
	await acceptGate(page);
	await seedLayout(page, [
		{ instanceId: 'wgt_rss', widgetId: 'rss', x: 0, y: 0, w: 4, h: 4, settings }
	]);
	await page.reload();
}

test('a tile reads its feeds, flags the dead one, and the reader keeps a stranger’s HTML inert', async ({
	page
}) => {
	const now = Date.now();
	const fetched: string[] = [];
	page.on('request', (request) => fetched.push(new URL(request.url()).hostname));
	const asked = await answerFeeds(page, now);

	await seedRss(page, { feeds: [GOOD, DEAD], lastOpenedAt: now - 60 * MINUTE });

	const list = page.getByTestId('rss-list');
	await expect(list.getByRole('link', { name: 'Tin mới nhất' })).toBeVisible();
	// Unread since the watermark an hour ago: the new story, not the old one.
	await expect(page.locator('.tp-rss-item__dot')).toHaveCount(1);
	// doc 08 §4: the dead feed gets its own chip; the other keeps working.
	await expect(page.getByTestId('rss-chips')).toContainText('không phải nguồn tin');
	expect(new Set(asked)).toEqual(new Set([GOOD, DEAD]));

	await page.getByRole('button', { name: 'mở chi tiết' }).click();
	await expect(page).toHaveURL(/\/w\/rss\?i=wgt_rss/);

	await page.getByRole('button', { name: /Tin mới nhất/ }).click();
	const summary = page.getByTestId('feed-html');
	await expect(summary).toContainText('Mở đầu');
	const html = await summary.innerHTML();
	expect(html).not.toMatch(/<img|<script|onerror|tracker\.example/);
	expect(html).toContain('rel="noopener noreferrer"');
	await expect(summary).toHaveAttribute('lang', 'vi');

	const open = page.getByTestId('rssd-open');
	await expect(open).toHaveAttribute('href', 'https://vnexpress.net/a');
	await expect(open).toHaveAttribute('target', '_blank');
	await expect(open).toHaveAttribute('rel', 'noopener noreferrer');

	// Opening the detail is what "read" means: back on the deck, the dot is gone.
	await page.keyboard.press('Escape');
	await expect(page).toHaveURL(/\/$/);
	await expect(list.getByRole('link', { name: 'Tin mới nhất' })).toBeVisible();
	await expect(page.locator('.tp-rss-item__dot')).toHaveCount(0);

	// Nothing a feed carried was fetched by the browser — not the pixel, not a
	// favicon, not the feed itself. Every feed request went through /api/rss
	// (CLAUDE.md rule 2).
	for (const host of ['tracker.example', 'vnexpress.net', 'example.org']) {
		expect(fetched, host).not.toContain(host);
	}
});

test('the first feed is added from the tile itself, in the spelling the Worker insists on', async ({
	page
}) => {
	const now = Date.now();
	const asked = await answerFeeds(page, now);

	await seedRss(page, {});

	await page.getByTestId('rss-add-input').fill('http://vnexpress.net/rss/tin-moi-nhat.rss');
	await page.getByTestId('rss-add').click();

	await expect(
		page.getByTestId('rss-list').getByRole('link', { name: 'Tin mới nhất' })
	).toBeVisible();
	expect(asked).toEqual([GOOD]);
	// The watermark starts with the first feed: its back catalogue is not unread.
	await expect(page.locator('.tp-rss-item__dot')).toHaveCount(0);
});
