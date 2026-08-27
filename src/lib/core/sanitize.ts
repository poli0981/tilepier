import DOMPurify from 'dompurify';

/**
 * The `{@html}` gatekeeper (doc 15 §4, CLAUDE.md rule 7).
 *
 * Every string that reaches a `{@html}` in this app comes through here first,
 * and every call site carries a `// SAFETY:` comment naming this module —
 * `svelte/no-at-html-tags` is an eslint *error* with per-line disables only,
 * so there is no way to render raw HTML without saying out loud that you did.
 *
 * Two profiles are documented. This file ships the notes one; the RSS profile
 * (doc 15 §4: strict, **no `img`**, links forced to `rel="noopener noreferrer"`
 * and `target="_blank"`) arrives in Week 6 with the reader that needs it. They
 * are deliberately separate functions rather than one with a flag: the two
 * threat models are different — notes are the user's own text, RSS is a
 * stranger's — and a boolean parameter is one typo away from applying the
 * wrong one.
 */

/**
 * What CommonMark plus GFM tables and task lists actually emits, and nothing
 * else. An allowlist rather than a denylist, because a denylist is a list of
 * the attacks somebody thought of.
 */
const NOTE_TAGS = [
	'p',
	'br',
	'hr',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'blockquote',
	'pre',
	'code',
	'em',
	'strong',
	'del',
	'ul',
	'ol',
	'li',
	'a',
	'img',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td',
	// GFM task lists render a disabled checkbox; without it the boxes vanish
	// and a checklist reads as a bare list.
	'input'
];

const NOTE_ATTRS = ['href', 'title', 'src', 'alt', 'align', 'type', 'checked', 'disabled'];

/**
 * doc 15 §4 allows `img[src^=https]` in notes — the user's own content, low
 * risk — and nothing else. The scheme check is here rather than left to
 * `ALLOWED_URI_REGEXP` so that `data:` images, which the CSP does permit for
 * the app's own assets, cannot ride in through a note.
 *
 * The hook is registered once, at module load, and is idempotent: DOMPurify
 * keeps hooks in a list and would otherwise run the same check three times
 * after three imports.
 */
let hooked = false;

function installHooks(): void {
	if (hooked) return;
	hooked = true;

	DOMPurify.addHook('afterSanitizeAttributes', (node) => {
		if (!(node instanceof Element)) return;

		if (node.tagName === 'IMG') {
			const src = node.getAttribute('src') ?? '';
			if (!src.toLowerCase().startsWith('https://')) node.removeAttribute('src');
		}

		if (node.tagName === 'A' && node.hasAttribute('href')) {
			// A link in a note opens away from the deck, and `noopener` is what
			// stops the opened page reaching back through `window.opener`.
			node.setAttribute('rel', 'noopener noreferrer');
			node.setAttribute('target', '_blank');
		}

		if (node.tagName === 'INPUT') {
			// The only input a note may contain is GFM's task-list checkbox, and
			// it is never interactive: the source text is the source of truth, and
			// a checkbox that looked clickable but changed nothing would lie.
			if (node.getAttribute('type') !== 'checkbox') {
				node.remove();
				return;
			}
			node.setAttribute('disabled', 'disabled');
		}
	});
}

/**
 * Sanitises rendered note markdown. The input is HTML that `marked` produced
 * from the user's text — which is *not* a reason to trust it, because the
 * user's text may itself contain HTML that marked passed straight through.
 */
export function sanitizeNoteHtml(html: string): string {
	installHooks();

	return DOMPurify.sanitize(html, {
		ALLOWED_TAGS: NOTE_TAGS,
		ALLOWED_ATTR: NOTE_ATTRS,
		// Belt and braces with the hook above: no `javascript:`, no `data:` in a
		// link, no `vbscript:`.
		ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|#|\/|\.)/i,

		// `ALLOWED_URI_REGEXP` is applied to **every** attribute value, not only
		// to the ones that hold URLs — DOMPurify drops any attribute whose value
		// neither matches it nor sits in its URI-safe list. Tightening the regexp
		// therefore has a side effect nobody would predict from its name: with
		// the pattern above and nothing else, `type="checkbox"` was rejected as
		// an unsafe URI, the attribute vanished, and the hook below then removed
		// the orphaned `<input>` — so GFM task lists silently lost their boxes.
		// Measured 2026-08-27. These four carry no URLs and are exempted by name.
		ADD_URI_SAFE_ATTR: ['type', 'checked', 'disabled', 'align']

		// **No `USE_PROFILES`.** Setting it alongside `ALLOWED_TAGS` does not
		// narrow the allowlist to the intersection, as it reads — it widens it to
		// the whole HTML profile. Measured 2026-08-27: with
		// `USE_PROFILES: { html: true }` a `<form>` came through intact, and
		// without it the same input sanitised to its text. It was in this config
		// as "belt and braces" and was doing the opposite of that, which is the
		// most dangerous kind of wrong for a sanitiser to be. The XSS corpus in
		// `sanitize.svelte.test.ts` is what caught it.
	});
}
