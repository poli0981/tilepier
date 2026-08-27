import { describe, expect, it } from 'vitest';
import { sanitizeNoteHtml } from './sanitize';

/**
 * doc 19 §3.6: "Sanitizers: DOMPurify configs (notes vs RSS) against an XSS
 * corpus (script, event handlers, javascript: URLs, svg payloads, data:
 * images)". This is the notes half; the RSS profile lands in Week 6.
 *
 * Browser project — the `.svelte.` infix selects it (doc 19 §1) — because
 * DOMPurify parses with the real DOM. A stubbed one would be testing the stub.
 *
 * Every case asserts on what *survives*, not on what was removed. "The output
 * no longer contains the word script" is a weaker claim than "the output
 * contains no executable anything", and the difference is where sanitiser
 * tests usually go wrong.
 */

function clean(html: string): string {
	return sanitizeNoteHtml(html);
}

describe('script injection', () => {
	it('drops a script element entirely', () => {
		const out = clean('<p>hi</p><script>alert(1)</script>');
		expect(out).toContain('<p>hi</p>');
		expect(out.toLowerCase()).not.toContain('<script');
		expect(out).not.toContain('alert(1)');
	});

	it('drops a script hidden behind broken markup', () => {
		const out = clean('<img src=x onerror=alert(1)>');
		expect(out.toLowerCase()).not.toContain('onerror');
	});

	it('drops every event handler attribute', () => {
		for (const handler of ['onclick', 'onload', 'onmouseover', 'onfocus', 'onanimationstart']) {
			const out = clean(`<p ${handler}="alert(1)">text</p>`);
			expect(out.toLowerCase(), handler).not.toContain(handler);
			expect(out).toContain('text');
		}
	});
});

describe('URL schemes', () => {
	it('strips a javascript: link but keeps the text', () => {
		const out = clean('<a href="javascript:alert(1)">click</a>');
		expect(out.toLowerCase()).not.toContain('javascript:');
		expect(out).toContain('click');
	});

	it('strips the obfuscated spellings too', () => {
		for (const href of [
			'JaVaScRiPt:alert(1)',
			'java\tscript:alert(1)',
			'javascript:alert(1)',
			'vbscript:msgbox(1)'
		]) {
			const out = clean(`<a href="${href}">x</a>`);
			expect(out.toLowerCase(), href).not.toMatch(/javascript:|vbscript:/);
		}
	});

	it('keeps the links a person actually writes', () => {
		expect(clean('<a href="https://example.com">x</a>')).toContain('https://example.com');
		expect(clean('<a href="mailto:a@b.co">x</a>')).toContain('mailto:a@b.co');
		expect(clean('<a href="#section">x</a>')).toContain('#section');
	});

	it('marks every surviving link noopener and out-of-page', () => {
		// The opened page must not be able to reach back through window.opener.
		const out = clean('<a href="https://example.com">x</a>');
		expect(out).toContain('rel="noopener noreferrer"');
		expect(out).toContain('target="_blank"');
	});
});

describe('images', () => {
	it('keeps an https image, which doc 15 §4 allows in notes', () => {
		expect(clean('<img src="https://example.com/a.png" alt="a">')).toContain(
			'https://example.com/a.png'
		);
	});

	it('drops the src of an http image', () => {
		// The CSP would block it anyway; a broken-image icon in someone's note is
		// a worse outcome than no image.
		expect(clean('<img src="http://example.com/a.png">')).not.toContain('http://example.com');
	});

	it('drops a data: image', () => {
		const out = clean('<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">');
		expect(out).not.toContain('data:image');
	});
});

describe('svg and other payload carriers', () => {
	it('drops an svg wholesale', () => {
		const out = clean('<svg><script>alert(1)</script></svg>');
		expect(out.toLowerCase()).not.toContain('<svg');
		expect(out.toLowerCase()).not.toContain('<script');
	});

	it('drops an svg animation payload', () => {
		const out = clean(
			'<svg><a><animate attributeName="href" values="javascript:alert(1)"/></a></svg>'
		);
		expect(out.toLowerCase()).not.toContain('javascript:');
		expect(out.toLowerCase()).not.toContain('animate');
	});

	it('drops iframes, objects, embeds and forms', () => {
		for (const tag of ['iframe', 'object', 'embed', 'form', 'style', 'base', 'meta', 'link']) {
			const out = clean(`<${tag} src="x">y</${tag}>`);
			expect(out.toLowerCase(), tag).not.toContain(`<${tag}`);
		}
	});
});

describe('what a note is allowed to be', () => {
	it('keeps the markup CommonMark and GFM produce', () => {
		const out = clean(
			'<h2>Title</h2><p><strong>bold</strong> <em>italic</em> <del>gone</del></p>' +
				'<ul><li>one</li></ul><pre><code>code</code></pre>' +
				'<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>'
		);

		for (const fragment of ['<h2>', '<strong>', '<em>', '<del>', '<ul>', '<pre>', '<table>']) {
			expect(out, fragment).toContain(fragment);
		}
	});

	it('keeps a GFM task list, and makes its boxes inert', () => {
		// The source text is the source of truth; a checkbox that looked
		// clickable but changed nothing would lie about what it does.
		const out = clean('<ul><li><input type="checkbox" checked> done</li></ul>');
		expect(out).toContain('type="checkbox"');
		expect(out).toContain('disabled');
	});

	it('removes an input that is not a task-list checkbox', () => {
		const out = clean('<input type="text" name="password">');
		expect(out.toLowerCase()).not.toContain('<input');
	});

	it('leaves plain text completely alone', () => {
		expect(clean('just words')).toBe('just words');
		expect(clean('')).toBe('');
	});

	it('escapes rather than executes a string that looks like markup', () => {
		// The case journey #5 checks end to end.
		const out = clean('<p>2 &lt; 3 &amp;&amp; 4 &gt; 1</p>');
		expect(out).toContain('2 &lt; 3');
	});
});
