import { describe, expect, it } from 'vitest';
import {
	ATOM_CORNERS,
	ATOM_RELEASES,
	HTML_PAGE,
	RDF_FEED,
	RSS_NEWS,
	RSS_ESCAPED_LINKS,
	RSS_UNDATED,
	RSS_ZONELESS_ITEMS,
	rssWithItems
} from './__fixtures__/feeds';
import { FEED_MAX_ITEMS, FEED_SUMMARY_MAX_CHARS, parseFeed } from './feed-parse';

/**
 * doc 10 §7: RSS 2.0, Atom and RDF into one shape. The fixtures copy the
 * structure of feeds measured on 2026-09-24 with text written for the tests
 * (`__fixtures__/feeds.ts` says why).
 */

const at = (iso: string) => Date.parse(iso);

describe('RSS 2.0', () => {
	const feed = parseFeed(RSS_NEWS, 'https://news.example.vn/rss/tin-moi-nhat.rss');

	it('reads the channel, not the image block beside it', () => {
		expect(feed?.title).toBe('Tin mới nhất - Báo Thử Nghiệm');
		expect(feed?.link).toBe('https://news.example.vn/rss/tin-moi-nhat.rss');
		expect(feed?.lang).toBe('vi');
	});

	it('orders entries newest first, whatever order the document has them in', () => {
		expect(feed?.items.map((item) => item.title)).toEqual([
			'Giá xăng giảm từ chiều nay',
			'Mưa lớn ở Hà Nội & các tỉnh lân cận',
			'Đội tuyển thắng trận mở màn'
		]);
		expect(feed?.items[0]?.publishedAt).toBe(at('2026-09-24T09:30:00Z'));
	});

	it('keeps a CDATA description as the HTML it is — unsanitised, for the client', () => {
		const rain = feed?.items[1];
		expect(rain?.summaryHtml).toContain('<img src="https://img.example.vn/1.jpg?w=1200&h=0">');
		expect(rain?.summaryHtml).toContain('Nhiệt độ giảm nhẹ');
		expect(rain?.id).toBe('https://news.example.vn/mua-lon-1.html');
		expect(rain?.link).toBe('https://news.example.vn/mua-lon-1.html');
	});

	it('decodes an escaped description to HTML, and its references once', () => {
		// `&amp;#8217;` in the document is the HTML text `&#8217;`: one layer only.
		expect(feed?.items[2]?.summaryHtml).toBe('<p>Bàn thắng duy nhất ở phút 90&#8217;.</p>');
	});

	it('names the author from an RSS address', () => {
		expect(feed?.items[2]?.author).toBe('Phóng viên Thể thao');
		expect(feed?.items[0]?.author).toBeNull();
	});
});

describe('Atom', () => {
	it("reads GitHub's release shape: alternate link, escaped HTML, updated", () => {
		const feed = parseFeed(ATOM_RELEASES, 'https://code.example.org/acme/widget/releases.atom');
		expect(feed?.title).toBe('Release notes from widget');
		expect(feed?.link).toBe('https://code.example.org/acme/widget/releases');
		expect(feed?.lang).toBe('en-US');

		const latest = feed?.items[0];
		expect(latest?.title).toBe('v1.2.0');
		expect(latest?.id).toBe('tag:code.example.org,2008:Repository/1/v1.2.0');
		expect(latest?.publishedAt).toBe(at('2026-09-08T13:17:43Z'));
		expect(latest?.summaryHtml).toContain('<h3>Changes</h3>');
		expect(latest?.summaryHtml).toContain(
			'<a href="https://code.example.org/acme/widget/pull/7">#7</a>'
		);
		expect(latest?.author).toBe('maintainer');
	});

	it('resolves relative links through xml:base, entry over feed', () => {
		const feed = parseFeed(ATOM_CORNERS, 'https://blog.example.org/feed.xml');
		expect(feed?.link).toBe('https://blog.example.org/');
		expect(feed?.items.find((item) => item.title === 'Comparing things')?.link).toBe(
			'https://blog.example.org/posts/compare'
		);
	});

	it('prefers the alternate link over an enclosure', () => {
		const feed = parseFeed(ATOM_CORNERS, 'https://blog.example.org/feed.xml');
		expect(feed?.items.find((item) => item.id === 'urn:uuid:2')?.link).toBe(
			'https://blog.example.org/posts/two'
		);
	});

	it('makes titles plain text whatever their type', () => {
		const feed = parseFeed(ATOM_CORNERS, 'https://blog.example.org/feed.xml');
		expect(feed?.title).toBe('Notes and Asides');
		expect(feed?.items.find((item) => item.id === 'urn:uuid:2')?.title).toBe('An xhtml title');
	});

	it('shows a text summary as text, and prefers it over the content', () => {
		const feed = parseFeed(ATOM_CORNERS, 'https://blog.example.org/feed.xml');
		const entry = feed?.items.find((item) => item.title === 'Comparing things');
		// RFC 4287: a text construct with no type is text, so its `<` is a
		// character, escaped here so the reader cannot take it for markup.
		expect(entry?.summaryHtml).toBe('When a &lt; b and b &lt; c');
		expect(entry?.publishedAt).toBe(at('2026-09-20T01:00:00Z'));
	});

	it('keeps XHTML content as markup', () => {
		const xhtml = ATOM_CORNERS.replace(/<summary[^>]*>.*<\/summary>/, '');
		const entry = parseFeed(xhtml, 'https://blog.example.org/feed.xml')?.items.find(
			(item) => item.title === 'Comparing things'
		);
		expect(entry?.summaryHtml).toContain('<p>X &lt; Y, <em>always</em>.</p>');
	});

	it('falls back from published to updated, and reads a date-only value', () => {
		const feed = parseFeed(ATOM_CORNERS, 'https://blog.example.org/feed.xml');
		expect(feed?.items.find((item) => item.id === 'urn:uuid:2')?.publishedAt).toBe(
			at('2026-09-19T00:00:00Z')
		);
	});
});

describe('RDF (RSS 1.0)', () => {
	it('reads items that are siblings of the channel', () => {
		const feed = parseFeed(RDF_FEED, 'https://science.example.net/rss');
		expect(feed?.title).toBe('Science Wire');
		expect(feed?.lang).toBe('en-GB');
		expect(feed?.items.map((item) => item.id)).toEqual([
			'https://science.example.net/story/2',
			'https://science.example.net/story/1'
		]);
		// No <link> on the second: rdf:about is the page.
		expect(feed?.items[0]?.link).toBe('https://science.example.net/story/2');
		expect(feed?.items[1]?.author).toBe('Staff');
	});
});

describe('entries without dates or ids (doc 08 §4)', () => {
	const feed = parseFeed(RSS_UNDATED, 'https://undated.example.com/rss');

	it('keeps undated entries, in the feed’s own order, and marks them undated', () => {
		expect(feed?.items.map((item) => item.title)).toEqual([
			'First',
			'Second, link only in guid',
			'Third, a guid that is not a link',
			'Fourth, title only'
		]);
		expect(feed?.items.every((item) => item.publishedAt === null)).toBe(true);
	});

	it('takes a permalink guid as the link, and a non-permalink one as id only', () => {
		expect(feed?.items[1]?.link).toBe('https://undated.example.com/2');
		expect(feed?.items[2]?.link).toBeNull();
		expect(feed?.items[2]?.id).toBe('abc-3');
	});

	it('drops an entry with nothing to call it by, and a duplicate', () => {
		expect(feed?.items).toHaveLength(4);
		expect(new Set(feed?.items.map((item) => item.id)).size).toBe(4);
	});
});

describe('limits', () => {
	it('keeps the newest FEED_MAX_ITEMS, not the first', () => {
		const feed = parseFeed(rssWithItems(FEED_MAX_ITEMS + 20), 'https://many.example.com/rss');
		expect(feed?.items).toHaveLength(FEED_MAX_ITEMS);
		const times = feed?.items.map((item) => item.publishedAt ?? 0) ?? [];
		expect([...times].sort((a, b) => b - a)).toEqual(times);
		// Item 49 is 22 Aug 01:00, among the newest; item 0 is 1 Aug, among the oldest.
		expect(feed?.items.some((item) => item.title === 'Item 49')).toBe(true);
		expect(feed?.items.some((item) => item.title === 'Item 0')).toBe(false);
	});

	it('cuts a long summary to FEED_SUMMARY_MAX_CHARS', () => {
		const long = RSS_UNDATED.replace(
			'<title>First</title><link>',
			`<title>First</title><description><![CDATA[<p>${'word '.repeat(2000)}</p>]]></description><link>`
		);
		const summary = parseFeed(long, 'https://undated.example.com/rss')?.items[0]?.summaryHtml ?? '';
		expect(summary.length).toBeLessThanOrEqual(FEED_SUMMARY_MAX_CHARS);
		expect(summary.endsWith('…')).toBe(true);
	});

	it('drops a link that is not http(s)', () => {
		const hostile = RSS_UNDATED.replace(
			'<link>https://undated.example.com/1</link>',
			'<link>javascript:alert(1)</link>'
		);
		expect(parseFeed(hostile, 'https://undated.example.com/rss')?.items[0]?.link).toBeNull();
	});
});

describe('what is not a feed', () => {
	it.each([
		['an HTML page', HTML_PAGE],
		['plain text', 'just some words & more'],
		['an empty document', ''],
		['XML with another root', '<?xml version="1.0"?><urlset><url/></urlset>'],
		['an RSS root with no channel', '<rss version="2.0"></rss>']
	])('%s is null', (_name, text) => {
		expect(parseFeed(text, 'https://example.com/feed')).toBeNull();
	});

	it('reads a feed with no entries as a feed, not as nothing', () => {
		const feed = parseFeed(
			'<rss version="2.0"><channel><title>Quiet</title></channel></rss>',
			'https://q.example.com/'
		);
		expect(feed).toEqual({ title: 'Quiet', link: null, lang: null, items: [] });
	});
});

/**
 * Two faults the fixtures above could not show, found by running real feeds
 * through the local Worker (workerd) before merge, as the plan review asked.
 */
describe('what real feeds showed (2026-09-24)', () => {
	it("undoes the feed's escaping in links and guids — BBC's `&amp;` is `&`", () => {
		const item = parseFeed(RSS_ESCAPED_LINKS, 'https://feeds.example.co.uk/news/rss.xml')?.items[0];
		expect(item?.link).toBe(
			'https://www.example.co.uk/news/articles/1?at_medium=RSS&at_campaign=rss'
		);
		expect(item?.id).toBe('https://www.example.co.uk/news/articles/1#0&1');
	});

	it('undoes it in attributes too — an Atom href', () => {
		const atom = ATOM_RELEASES.replace(
			'href="https://code.example.org/acme/widget/releases/tag/v1.2.0"',
			'href="https://code.example.org/acme/widget/releases?tag=v1.2.0&amp;page=1"'
		);
		expect(parseFeed(atom, 'https://code.example.org/feed')?.items[0]?.link).toBe(
			'https://code.example.org/acme/widget/releases?tag=v1.2.0&page=1'
		);
	});

	it("reads Tuổi Trẻ's zoneless item dates in the zone its channel names", () => {
		const feed = parseFeed(RSS_ZONELESS_ITEMS, 'https://tt.example.vn/home.rss');
		// 9:41 PM at GMT+7 is 14:41 UTC — not 21:41 UTC, seven hours in the future.
		expect(feed?.items[0]?.publishedAt).toBe(Date.parse('2026-09-24T14:41:00Z'));
		expect(feed?.items[1]?.publishedAt).toBe(Date.parse('2026-09-24T01:05:00Z'));
		expect(feed?.link).toBe('https://tt.example.vn/home.htm');
		expect(feed?.lang).toBe('vi-vn');
	});

	it('reads zoneless dates as UTC when the channel names no zone either', () => {
		const bare = RSS_ZONELESS_ITEMS.replace(/<lastBuildDate>.*<\/lastBuildDate>/, '');
		expect(parseFeed(bare, 'https://tt.example.vn/home.rss')?.items[0]?.publishedAt).toBe(
			Date.parse('2026-09-24T21:41:00Z')
		);
	});
});
