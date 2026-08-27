import { describe, expect, it } from 'vitest';
import { LARGE_SOURCE_CHARS, SLOW_PREVIEW_MS, renderMarkdown } from './markdown';

/**
 * doc 07 §4's markdown support, and the one-way pipeline CLAUDE.md rule 7
 * requires: `marked` → `sanitizeNoteHtml` → the caller.
 *
 * Browser project — the `.svelte.` infix selects it (doc 19 §1) — because the
 * sanitiser half parses with a real DOM. The sanitiser's own allowlist is
 * exercised exhaustively in `sanitize.svelte.test.ts`; what this file checks is
 * that the two halves are actually wired together, in that order.
 */

describe('CommonMark', () => {
	it('renders the everyday marks', () => {
		const html = renderMarkdown('# Title\n\nSome **bold** and *italic* text.');

		expect(html).toContain('<h1>Title</h1>');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
	});

	it('renders lists, quotes and code', () => {
		expect(renderMarkdown('- one\n- two')).toContain('<li>one</li>');
		expect(renderMarkdown('> quoted')).toContain('<blockquote>');
		expect(renderMarkdown('`inline`')).toContain('<code>inline</code>');
		expect(renderMarkdown('```\nblock\n```')).toContain('<pre>');
	});

	it('treats a single newline as a line break', () => {
		// Markdown's rule that it does not surprises everyone who has not read
		// the spec, and a note is not a document being typeset.
		expect(renderMarkdown('one\ntwo')).toContain('<br>');
	});
});

describe('GFM', () => {
	it('renders tables', () => {
		const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');

		expect(html).toContain('<table>');
		expect(html).toContain('<th>a</th>');
		expect(html).toContain('<td>1</td>');
	});

	it('renders task lists, with inert boxes', () => {
		const html = renderMarkdown('- [x] done\n- [ ] todo');

		expect(html).toContain('type="checkbox"');
		// The sanitiser disables them: the source text is the source of truth.
		expect(html).toContain('disabled');
	});

	it('renders strikethrough', () => {
		expect(renderMarkdown('~~gone~~')).toContain('<del>gone</del>');
	});
});

describe('the sanitiser is not optional', () => {
	it('strips a script the markdown passed straight through', () => {
		// `marked` has no option that disables raw HTML in v18 — doc 07 §4's
		// `html: false` does not exist — so the allowlist is what enforces it,
		// and this asserts the pipeline actually reaches it.
		const html = renderMarkdown('Hello\n\n<script>alert(1)</script>');

		expect(html).toContain('Hello');
		expect(html.toLowerCase()).not.toContain('<script');
	});

	it('strips an inline event handler', () => {
		expect(renderMarkdown('<img src=x onerror=alert(1)>').toLowerCase()).not.toContain('onerror');
	});

	it('neutralises a javascript: link written as markdown', () => {
		const html = renderMarkdown('[click](javascript:alert(1))');
		expect(html.toLowerCase()).not.toContain('javascript:');
	});

	it('marks an ordinary link noopener', () => {
		expect(renderMarkdown('[x](https://example.com)')).toContain('rel="noopener noreferrer"');
	});
});

describe('thresholds', () => {
	it('names the size past which the preview waits for a pause', () => {
		// doc 07 §4's own numbers, exported so the component does not repeat them.
		expect(LARGE_SOURCE_CHARS).toBe(20_000);
		expect(SLOW_PREVIEW_MS).toBe(500);
	});

	it('renders a large document rather than refusing it', () => {
		// The threshold delays the render; it never skips one.
		const html = renderMarkdown(`# Big\n\n${'word '.repeat(5000)}`);
		expect(html).toContain('<h1>Big</h1>');
	});
});

describe('edge cases', () => {
	it('returns nothing for nothing', () => {
		expect(renderMarkdown('')).toBe('');
	});

	it('leaves Vietnamese text intact', () => {
		expect(renderMarkdown('Ghi chú của tôi')).toContain('Ghi chú của tôi');
	});
});
