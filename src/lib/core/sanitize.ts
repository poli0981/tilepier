import createPurifier, { type DOMPurify } from 'dompurify';

/**
 * The `{@html}` gatekeeper (doc 15 §4, CLAUDE.md rule 7).
 *
 * Every string that reaches a `{@html}` in this app comes through here first,
 * and every call site carries a `// SAFETY:` comment naming this module —
 * `svelte/no-at-html-tags` is an eslint *error* with per-line disables only,
 * so there is no way to render raw HTML without saying out loud that you did.
 *
 * Two profiles, as doc 15 §4 has them: notes (`sanitizeNoteHtml`) and RSS
 * (`sanitizeRssHtml` — strict, **no `img`**, links forced to
 * `rel="noopener noreferrer"` and `target="_blank"`). They are deliberately
 * separate functions rather than one with a flag: the two threat models are
 * different — notes are the user's own text, RSS is a stranger's — and a
 * boolean parameter is one typo away from applying the wrong one.
 *
 * **Each profile owns its own DOMPurify instance.** Until Week 6 the notes hook
 * sat on the library's global instance, which made "separate functions" true of
 * the configs and false of the hooks: DOMPurify keeps hooks per instance, so a
 * second profile on the same instance would have run the first one's hook on
 * every node, and the other way round. `createPurifier()` makes an instance
 * with a hook list of its own. Measured 2026-09-25: with the old module loaded,
 * the global instance added `target="_blank"` to a link nobody had asked it to
 * touch.
 */

/**
 * An instance for one profile, made on first use.
 *
 * **`null` when DOMPurify cannot run**, and the callers turn that into an empty
 * string. `sanitize()` on an unsupported instance returns its input *unchanged*
 * (`purify.es.mjs`, "Return dirty HTML if DOMPurify cannot run") — a sanitiser
 * that fails open. Nothing renders these outside a browser today; this is what
 * keeps it that way if something ever does.
 */
function makePurifier(onElement: (node: Element) => void): DOMPurify | null {
	const purifier = createPurifier();
	if (!purifier.isSupported) return null;

	purifier.addHook('afterSanitizeAttributes', (node) => {
		if (node instanceof Element) onElement(node);
	});
	return purifier;
}

/**
 * A link out of a note or a feed opens away from the deck, and `noopener` is
 * what stops the opened page reaching back through `window.opener`.
 */
function openLinksAway(node: Element): void {
	if (node.tagName === 'A' && node.hasAttribute('href')) {
		node.setAttribute('rel', 'noopener noreferrer');
		node.setAttribute('target', '_blank');
	}
}

/* ─────────────────────────────────────────────────────────────── notes */

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
 */
function noteElement(node: Element): void {
	if (node.tagName === 'IMG') {
		const src = node.getAttribute('src') ?? '';
		if (!src.toLowerCase().startsWith('https://')) node.removeAttribute('src');
	}

	openLinksAway(node);

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
}

/** `undefined` until the first call; `null` where DOMPurify cannot run. */
let notePurifier: DOMPurify | null | undefined;

/**
 * Sanitises rendered note markdown. The input is HTML that `marked` produced
 * from the user's text — which is *not* a reason to trust it, because the
 * user's text may itself contain HTML that marked passed straight through.
 */
export function sanitizeNoteHtml(html: string): string {
	notePurifier ??= makePurifier(noteElement);
	if (notePurifier === null) return '';

	return notePurifier.sanitize(html, {
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

/* ──────────────────────────────────────────────────────────────── RSS */

/**
 * doc 08 §4 and doc 15 §4: paragraphs, links, lists, quotes, code — and
 * emphasis, because feeds mark it up with `b` and `i` as often as with `strong`
 * and `em`, and dropping those would only lose the words' weight, not the words.
 * Everything else is unwrapped to its text (DOMPurify keeps the content of an
 * element it drops), except the elements whose content is itself dangerous —
 * `script`, `style` and the rest of DOMPurify's `FORBID_CONTENTS`.
 *
 * **No `img`, in any form.** An image in a stranger's summary is a request to a
 * stranger's host from the reader's browser the moment it renders — a tracking
 * pixel by another name — and doc 15 §2's `img-src` would refuse it anyway,
 * leaving a broken-image box. So it is not an attribute problem to be scrubbed:
 * the element does not survive.
 */
const RSS_TAGS = [
	'p',
	'br',
	'a',
	'ul',
	'ol',
	'li',
	'blockquote',
	'pre',
	'code',
	'em',
	'strong',
	'b',
	'i'
];

/** `title` is in DOMPurify's URI-safe list, so the regexp below leaves it be. */
const RSS_ATTRS = ['href', 'title'];

let rssPurifier: DOMPurify | null | undefined;

/**
 * Sanitises a feed item's `summaryHtml` — **a stranger's HTML**, which the
 * Worker cut to size but could not clean, having no DOM (`api-types.ts`).
 *
 * Only absolute `http(s):` and `mailto:` links survive. A relative href in a
 * feed means the *publisher's* site, and rendered here it would resolve against
 * this app's origin — a link to a page that does not exist, at best.
 */
export function sanitizeRssHtml(html: string): string {
	rssPurifier ??= makePurifier(openLinksAway);
	if (rssPurifier === null) return '';

	return rssPurifier.sanitize(html, {
		ALLOWED_TAGS: RSS_TAGS,
		ALLOWED_ATTR: RSS_ATTRS,
		ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i
	});
}
