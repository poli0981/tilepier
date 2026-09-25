import { describe, expect, it } from 'vitest';
import { sanitizeNoteHtml, sanitizeRssHtml } from './sanitize';

/**
 * doc 19 §3.6's RSS half: the strict profile against an XSS corpus. Browser
 * project, because DOMPurify parses with the real DOM.
 *
 * The notes corpus (`sanitize.svelte.test.ts`) is the model — every case
 * asserts on what *survives* — and this one adds what is different about a
 * stranger's HTML: no image of any kind, and no link that does not name its
 * own host.
 */

function clean(html: string): string {
	return sanitizeRssHtml(html);
}

describe('script injection', () => {
	it('drops a script element and what it contains', () => {
		const out = clean('<p>hi</p><script>alert(1)</script>');
		expect(out).toBe('<p>hi</p>');
	});

	it('drops every event handler attribute', () => {
		for (const handler of ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus']) {
			const out = clean(`<p ${handler}="alert(1)">text</p>`);
			expect(out.toLowerCase(), handler).not.toContain(handler);
			expect(out, handler).toContain('text');
		}
	});

	it('drops styles, iframes, objects, forms, and everything that rewrites the page', () => {
		for (const tag of [
			'style',
			'iframe',
			'object',
			'embed',
			'form',
			'base',
			'meta',
			'link',
			'input'
		]) {
			const out = clean(`<${tag} src="x" href="x">y</${tag}>`);
			expect(out.toLowerCase(), tag).not.toContain(`<${tag}`);
		}
	});

	it('drops svg and math wholesale', () => {
		const out = clean(
			'<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg><math><mi>x</mi></math>'
		);
		expect(out.toLowerCase()).not.toMatch(/<svg|<math|javascript:|animate/);
	});
});

describe('images (doc 15 §4: none, in any form)', () => {
	it('drops an https image outright — a stranger’s pixel is a request to a stranger', () => {
		const out = clean('<p>a<img src="https://tracker.example/p.gif" alt="x">b</p>');
		expect(out).toBe('<p>ab</p>');
	});

	it('drops every other way a page can fetch an image', () => {
		const out = clean(
			'<picture><source srcset="https://x.example/a.webp"><img src="https://x.example/a.jpg"></picture>' +
				'<video poster="https://x.example/p.jpg" src="https://x.example/v.mp4"></video>' +
				'<p style="background:url(https://x.example/bg.png)">t</p>' +
				'<svg><image href="https://x.example/i.png"/></svg>'
		);
		expect(out).not.toContain('x.example');
		expect(out).toContain('t');
	});
});

describe('links', () => {
	it('keeps an absolute link, opened away from the deck with no opener', () => {
		const out = clean('<a href="https://example.com/story">read</a>');
		expect(out).toContain('href="https://example.com/story"');
		expect(out).toContain('rel="noopener noreferrer"');
		expect(out).toContain('target="_blank"');
	});

	it('keeps mailto', () => {
		expect(clean('<a href="mailto:desk@example.com">write</a>')).toContain(
			'mailto:desk@example.com'
		);
	});

	it('drops a relative link — it means the publisher’s site, not this one', () => {
		for (const href of ['/story/1', 'story/1', '../story', '#top', '//evil.example/x']) {
			const out = clean(`<a href="${href}">x</a>`);
			expect(out, href).not.toContain('href=');
			expect(out, href).toContain('x');
		}
	});

	it('drops every script-bearing scheme, however it is spelt', () => {
		for (const href of [
			'javascript:alert(1)',
			'JaVaScRiPt:alert(1)',
			'java\tscript:alert(1)',
			'vbscript:msgbox(1)',
			'data:text/html,<script>alert(1)</script>'
		]) {
			const out = clean(`<a href="${href}">x</a>`);
			expect(out.toLowerCase(), href).not.toMatch(/javascript|vbscript|data:/);
		}
	});
});

describe('what a summary is allowed to be', () => {
	it('keeps paragraphs, lists, quotes, code and emphasis', () => {
		const out = clean(
			'<p><strong>s</strong> <em>e</em> <b>b</b> <i>i</i><br></p><ul><li>one</li></ul>' +
				'<ol><li>two</li></ol><blockquote>q</blockquote><pre><code>c</code></pre>'
		);
		for (const fragment of [
			'<strong>',
			'<em>',
			'<b>',
			'<i>',
			'<br>',
			'<ul>',
			'<ol>',
			'<blockquote>',
			'<pre>',
			'<code>'
		]) {
			expect(out, fragment).toContain(fragment);
		}
	});

	it('unwraps what it does not allow, keeping the words', () => {
		const out = clean(
			'<div class="x" id="y"><h2>Title</h2><span style="color:red">body</span><table><tr><td>cell</td></tr></table></div>'
		);
		expect(out).toBe('Titlebodycell');
	});

	it('keeps no class, id or style — the feed’s CSS is not ours', () => {
		const out = clean('<p class="lead" id="p1" style="font-size:40px">t</p>');
		expect(out).toBe('<p>t</p>');
	});

	it('escapes rather than executes text that looks like markup', () => {
		expect(clean('<p>2 &lt; 3 &amp;&amp; &lt;script&gt;</p>')).toBe(
			'<p>2 &lt; 3 &amp;&amp; &lt;script&gt;</p>'
		);
	});

	it('leaves plain text alone', () => {
		expect(clean('just words')).toBe('just words');
		expect(clean('')).toBe('');
	});
});

describe('two profiles, two instances', () => {
	it('never lets the notes profile’s image rule into the RSS one', () => {
		// Notes keep an https image; if the two shared a DOMPurify instance or a
		// config, running notes first could leave its allowlist in place.
		expect(sanitizeNoteHtml('<img src="https://example.com/a.png">')).toContain('<img');
		expect(clean('<img src="https://example.com/a.png">')).toBe('');
	});

	it('never lets the RSS profile narrow the notes one', () => {
		clean('<h2>t</h2><table><tr><td>x</td></tr></table>');

		const note = sanitizeNoteHtml('<h2>t</h2><table><tbody><tr><td>x</td></tr></tbody></table>');
		expect(note).toContain('<h2>');
		expect(note).toContain('<table>');
	});
});
