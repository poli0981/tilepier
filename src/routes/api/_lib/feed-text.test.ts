import { describe, expect, it } from 'vitest';
import {
	clip,
	decodeHtmlEntities,
	decodeXmlEntities,
	escapeHtml,
	plainText,
	rawToHtml,
	stripTags,
	truncateHtml
} from './feed-text';

/**
 * The text half of doc 10 §7's normaliser. The parser hands these raw
 * strings — references undecoded, CDATA markers in place — so each rule here
 * is the only thing standing between a feed's escaping and what a reader sees.
 */

describe('entity references', () => {
	it("decodes XML's five and numeric references, once", () => {
		expect(decodeXmlEntities('AT&amp;T &lt;b&gt; &quot;q&quot; &apos;a&apos;')).toBe(
			'AT&T <b> "q" \'a\''
		);
		expect(decodeXmlEntities('&#8217; &#x2019; &#X2019;')).toBe('’ ’ ’');
		// Once: `&amp;lt;` is the text "&lt;", not a second layer to peel.
		expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;');
	});

	it('leaves HTML-only names to the HTML decoder', () => {
		expect(decodeXmlEntities('Ha&rsquo;s')).toBe('Ha&rsquo;s');
		expect(decodeHtmlEntities('Ha&rsquo;s &mdash; &hellip;&nbsp;x')).toBe('Ha’s — … x');
	});

	it('turns what an HTML parser would refuse into U+FFFD, never a thrown error', () => {
		expect(decodeXmlEntities('&#0;|&#xD800;|&#x110000;|&#1114112;')).toBe('�|�|�|�');
	});

	it('does not read a property of Object as an entity', () => {
		// A bare index into the table would make `&constructor;` the source text
		// of `Object`. `hasOwn` keeps it what it is: text.
		expect(decodeHtmlEntities('&constructor; &toString; &__proto__;')).toBe(
			'&constructor; &toString; &__proto__;'
		);
	});

	it('leaves an ampersand that starts no reference alone', () => {
		expect(decodeHtmlEntities('R&D & more &;')).toBe('R&D & more &;');
	});
});

describe('raw element content', () => {
	it('takes CDATA literally and decodes the XML around it', () => {
		expect(rawToHtml('<![CDATA[<p>a &amp; b</p>]]>')).toBe('<p>a &amp; b</p>');
		expect(rawToHtml('&lt;p&gt;x&lt;/p&gt;')).toBe('<p>x</p>');
		expect(rawToHtml('A &amp; <![CDATA[<b>&amp;</b>]]> &lt;i&gt;')).toBe('A & <b>&amp;</b> <i>');
	});

	it('makes plain text of a title: markup out, both layers of references decoded', () => {
		expect(plainText('<![CDATA[Giá xăng <b>giảm</b>]]>', 300)).toBe('Giá xăng giảm');
		expect(plainText('Notes &lt;i&gt;and&lt;/i&gt; Asides', 300)).toBe('Notes and Asides');
		// Double-encoded by a CMS: XML's layer, then HTML's, and both are gone.
		expect(plainText('Ha&amp;rsquo;s &amp;amp; co', 300)).toBe('Ha’s & co');
		expect(plainText('  two\n\n  lines  ', 300)).toBe('two lines');
	});

	it('keeps two words two words when the tag between them goes', () => {
		expect(stripTags('a<br>b<!-- note -->c')).toBe('a b c');
	});

	it('escapes text meant to be read as text', () => {
		expect(escapeHtml('a < b & "c" > d')).toBe('a &lt; b &amp; &quot;c&quot; &gt; d');
	});
});

describe('cutting to size', () => {
	it('clips at a length with an ellipsis, never through a surrogate pair', () => {
		expect(clip('short', 10)).toBe('short');
		expect(clip('abcdefghij', 5)).toBe('abcd…');
		// 😀 is two UTF-16 units; a cut between them would leave a lone surrogate.
		const cut = clip('ab😀cd', 4);
		expect(cut).toBe('ab…');
		expect(cut.isWellFormed()).toBe(true);
	});

	it('never cuts HTML inside a tag', () => {
		const html = `<p>${'x'.repeat(10)}<a href="https://example.com/long">link</a></p>`;
		const cut = truncateHtml(html, 20);
		expect(cut).toBe(`<p>${'x'.repeat(10)}…`);
		expect(cut).not.toMatch(/<a[^>]*$/);
	});

	it('never cuts HTML inside an entity reference', () => {
		const html = `${'x'.repeat(10)}&hellip;tail`;
		// The cut would land between `&hel` and `lip;`.
		expect(truncateHtml(html, 14)).toBe(`${'x'.repeat(10)}…`);
	});

	it('never cuts HTML through a surrogate pair', () => {
		const cut = truncateHtml(`${'x'.repeat(8)}😀😀`, 10);
		expect(cut.isWellFormed()).toBe(true);
	});

	it('leaves HTML that fits alone, closing tags and all', () => {
		expect(truncateHtml('<p>ok</p>', 100)).toBe('<p>ok</p>');
	});
});
