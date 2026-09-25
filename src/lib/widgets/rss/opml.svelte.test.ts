import { describe, expect, it } from 'vitest';
import { exportOpml, importOpml, OPML_MAX_BYTES } from './opml';

/**
 * Browser project: import parses with the browser's own `DOMParser`, and a
 * stub of it would be testing the stub.
 */

const VNE = 'https://vnexpress.net/rss/tin-moi-nhat.rss';
const BBC = 'https://feeds.bbci.co.uk/news/rss.xml';
const HN = 'https://news.ycombinator.com/rss';

function opml(body: string): string {
	return `<?xml version="1.0"?><opml version="2.0"><head><title>x</title></head><body>${body}</body></opml>`;
}

describe('importOpml', () => {
	it('reads every feed, however deeply the exporter nested its folders', () => {
		const result = importOpml(
			opml(
				`<outline text="News"><outline text="VnE" xmlUrl="${VNE}"/>` +
					`<outline text="World"><outline text="BBC" type="rss" xmlUrl="${BBC}"/></outline></outline>`
			),
			[]
		);

		expect(result).toEqual({ ok: true, feeds: [VNE, BBC], added: 2, skipped: [] });
	});

	it('reads the lower-case attribute some exporters write', () => {
		expect(importOpml(opml(`<outline xmlurl="${HN}"/>`), [])).toMatchObject({ feeds: [HN] });
	});

	it('asks an http feed over https, as the box does (plan S8)', () => {
		const result = importOpml(
			opml('<outline xmlUrl="http://vnexpress.net/rss/tin-moi-nhat.rss"/>'),
			[]
		);

		expect(result).toMatchObject({ feeds: [VNE], added: 1 });
	});

	it('keeps what is there, and skips a feed it already has in any spelling', () => {
		const result = importOpml(
			opml(
				`<outline xmlUrl="https://VNEXPRESS.net/rss/tin-moi-nhat.rss#x"/><outline xmlUrl="${BBC}"/>`
			),
			[VNE]
		);

		expect(result).toEqual({
			ok: true,
			feeds: [VNE, BBC],
			added: 1,
			skipped: [{ url: 'https://VNEXPRESS.net/rss/tin-moi-nhat.rss#x', reason: 'duplicate' }]
		});
	});

	it('says why each refused feed was refused', () => {
		const result = importOpml(
			opml(
				'<outline xmlUrl="https://192.168.1.1/feed"/><outline xmlUrl="ftp://example.com/feed"/>' +
					'<outline xmlUrl="https://router.lan/rss"/>'
			),
			[]
		);

		expect(result.ok && result.skipped.map((skip) => skip.reason)).toEqual([
			'address',
			'scheme',
			'host'
		]);
	});

	it('stops at ten, and names the rest as full', () => {
		const outlines = Array.from(
			{ length: 12 },
			(_, i) => `<outline xmlUrl="https://example.com/${String(i)}.xml"/>`
		).join('');
		const result = importOpml(opml(outlines), []);

		expect(result).toMatchObject({ ok: true, added: 10 });
		expect(result.ok && result.skipped.map((skip) => skip.reason)).toEqual(['full', 'full']);
	});

	it('ignores outlines that carry no feed', () => {
		expect(importOpml(opml('<outline text="just a folder"/><outline xmlUrl="  "/>'), [])).toEqual({
			ok: true,
			feeds: [],
			added: 0,
			skipped: []
		});
	});

	it('refuses what is not OPML', () => {
		for (const text of ['not xml at all', '<rss><channel/></rss>', '<opml><body><outline']) {
			expect(importOpml(text, []), text).toEqual({ ok: false, reason: 'not-opml' });
		}
	});

	it('refuses a document that declares entities, before parsing it', () => {
		const bomb =
			'<?xml version="1.0"?><!DOCTYPE opml [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;">]>' +
			'<opml version="2.0"><body><outline text="&b;" xmlUrl="https://example.com/feed"/></body></opml>';

		expect(importOpml(bomb, [])).toEqual({ ok: false, reason: 'not-opml' });
	});

	it('refuses a file too large to be a feed list', () => {
		expect(importOpml(opml(' '.repeat(OPML_MAX_BYTES)), [])).toEqual({
			ok: false,
			reason: 'too-large'
		});
	});
});

describe('exportOpml', () => {
	const NOW = new Date(Date.UTC(2026, 8, 25, 9, 0));

	it('writes OPML 2.0 that its own import reads back', () => {
		const text = exportOpml(
			[
				{ url: VNE, title: 'VnExpress', link: 'https://vnexpress.net' },
				{ url: BBC, title: 'BBC News', link: null }
			],
			'TilePier feeds',
			NOW
		);

		expect(text).toContain('<opml version="2.0">');
		expect(text).toContain('<dateCreated>Fri, 25 Sep 2026 09:00:00 GMT</dateCreated>');
		expect(importOpml(text, [])).toEqual({ ok: true, feeds: [VNE, BBC], added: 2, skipped: [] });
	});

	it('escapes a stranger’s title and a query’s ampersand', () => {
		const text = exportOpml(
			[{ url: 'https://example.com/feed?a=1&b=2', title: 'Tom & "Jerry" <3', link: null }],
			'x',
			NOW
		);

		expect(text).toContain('text="Tom &amp; &quot;Jerry&quot; &lt;3"');
		expect(text).toContain('xmlUrl="https://example.com/feed?a=1&amp;b=2"');
		expect(importOpml(text, [])).toMatchObject({ feeds: ['https://example.com/feed?a=1&b=2'] });
	});
});
