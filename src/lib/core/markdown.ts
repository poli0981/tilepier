import { marked } from 'marked';
import { sanitizeNoteHtml } from './sanitize';

/**
 * Markdown → HTML for notes (doc 07 §4), and the only module that imports
 * `marked`.
 *
 * **Loaded dynamically by `TpMarkdown.svelte`**, and that is a bundle decision
 * rather than a stylistic one: `marked` and `dompurify` together are most of a
 * widget tile's 40 KB gzip budget (doc 20 §6), and the notes tile is otherwise
 * a textarea. Keeping the pair behind one dynamically-imported module puts
 * them in a chunk every consumer shares, and off the critical path of a deck
 * that has notes on it but is not looking at them.
 *
 * The pipeline is fixed and one-way: `marked` → `sanitizeNoteHtml` →
 * `{@html}`. Never marked alone. doc 15 §4 and CLAUDE.md rule 7 both say so,
 * and `svelte/no-at-html-tags` is an eslint error so the call site has to
 * disable it by hand and explain itself.
 */

marked.setOptions({
	// doc 07 §4: "CommonMark + GFM tables/task lists".
	gfm: true,
	// A single newline is a line break in a notes app. Markdown's rule that it
	// is not surprises everyone who has not read the spec, and a note is not a
	// document being typeset.
	breaks: true
});

/**
 * `marked` is configured with `gfm`, which does **not** disable raw HTML — the
 * option doc 07 §4 gestures at (`html: false`) does not exist in marked 18.
 * Raw HTML in the source therefore reaches the output intact, which is exactly
 * why the sanitiser is not optional and why doc 07 §4 already said the
 * allowlist is what enforces it rather than a parser flag.
 */
export function renderMarkdown(source: string): string {
	// `marked.parse` returns a promise only when an async extension is
	// registered; none is, so the synchronous overload is the honest signature.
	const html = marked.parse(source, { async: false });
	return sanitizeNoteHtml(html);
}

/**
 * doc 07 §4: "very large note (>100 KB) → preview virtualization not needed
 * v1, but debounce preview render to 500 ms above 20 KB". Rendering is
 * synchronous and blocks paint, so past this size the preview waits for a
 * pause in typing rather than re-parsing on every keystroke.
 *
 * Counted in UTF-16 units rather than bytes, which under-reports Vietnamese by
 * up to a third — close enough for a threshold, and free.
 */
export const LARGE_SOURCE_CHARS = 20_000;
export const SLOW_PREVIEW_MS = 500;
