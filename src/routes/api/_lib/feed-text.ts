/**
 * Text handling for `/api/rss` (doc 10 §7).
 *
 * The parser runs with `processEntities: false` (`feed-parse.ts` says why), so
 * every string it hands back still carries its references, and every field
 * that can hold markup arrives raw — CDATA markers and all. These are the few
 * transformations that turn that into the two shapes a `TpFeedItem` holds:
 * plain text for titles, and HTML for summaries.
 *
 * **Nothing here sanitises.** The Worker has no DOM, and doc 15 §4 puts the
 * sanitiser on the client, inside `TpFeedHtml`. What is here only has to be
 * faithful; the client has to be safe.
 */

const XML_ENTITIES: Readonly<Record<string, string>> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'"
};

/**
 * XML's five plus the named references feeds actually put in titles — which
 * arrive double-encoded often enough (a CMS escaping what was already escaped)
 * that a title reading "Ha&rsquo;s" is the common case, not the odd one.
 */
const HTML_ENTITIES: Readonly<Record<string, string>> = {
	...XML_ENTITIES,
	nbsp: ' ',
	ensp: ' ',
	emsp: ' ',
	thinsp: ' ',
	shy: '­',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	lsquo: '‘',
	rsquo: '’',
	sbquo: '‚',
	ldquo: '“',
	rdquo: '”',
	bdquo: '„',
	laquo: '«',
	raquo: '»',
	lsaquo: '‹',
	rsaquo: '›',
	bull: '•',
	middot: '·',
	prime: '′',
	Prime: '″',
	dagger: '†',
	Dagger: '‡',
	copy: '©',
	reg: '®',
	trade: '™',
	deg: '°',
	times: '×',
	divide: '÷',
	plusmn: '±',
	euro: '€',
	pound: '£',
	yen: '¥',
	cent: '¢',
	sect: '§',
	para: '¶'
};

const REFERENCE = /&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

/**
 * A numeric reference as an HTML parser reads it: NUL, a lone surrogate and
 * anything past Unicode all become U+FFFD rather than a thrown RangeError or a
 * string that is not valid UTF-16.
 */
function fromCodePoint(reference: string): string {
	const hex = reference[1] === 'x' || reference[1] === 'X';
	const value = Number.parseInt(reference.slice(hex ? 2 : 1), hex ? 16 : 10);
	if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '�';
	return String.fromCodePoint(value);
}

function decodeWith(table: Readonly<Record<string, string>>, text: string): string {
	return text.replace(REFERENCE, (match, reference: string) => {
		if (reference.startsWith('#')) return fromCodePoint(reference);
		// `hasOwn`, not a bare index: `&constructor;` must stay text, not become
		// `Object`'s source.
		return Object.hasOwn(table, reference) ? (table[reference] ?? match) : match;
	});
}

/** XML's five references and numeric ones. What a feed's own escaping used. */
export function decodeXmlEntities(text: string): string {
	return decodeWith(XML_ENTITIES, text);
}

/** XML's, numeric ones, and the named HTML references titles carry. */
export function decodeHtmlEntities(text: string): string {
	return decodeWith(HTML_ENTITIES, text);
}

const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;

/**
 * Raw element content — a stop node — as the HTML it carries.
 *
 * A CDATA section is taken literally; the text around it is XML, so its
 * references are decoded. That covers both ways a feed ships markup: inside
 * CDATA (VnExpress), and escaped (`&lt;p&gt;`, GitHub's Atom).
 */
export function rawToHtml(raw: string): string {
	let out = '';
	let last = 0;
	for (const match of raw.matchAll(CDATA)) {
		out += decodeXmlEntities(raw.slice(last, match.index)) + (match[1] ?? '');
		last = match.index + match[0].length;
	}
	return out + decodeXmlEntities(raw.slice(last));
}

/** Tags and comments out; a space in their place, so `a<br>b` stays two words. */
export function stripTags(html: string): string {
	return html.replace(/<!--[\s\S]*?-->|<[^>]*>/g, ' ');
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

/** At most `max` UTF-16 units and an ellipsis, never half a surrogate pair. */
export function clip(text: string, max: number): string {
	if (text.length <= max) return text;
	let cut = max - 1;
	if (cut > 0 && isHighSurrogate(text.charCodeAt(cut - 1))) cut -= 1;
	return `${text.slice(0, cut).trimEnd()}…`;
}

/**
 * A title, an author: plain text from raw element content.
 *
 * CDATA unwrapped and XML references decoded first, so that escaped markup
 * (`&lt;b&gt;`) becomes markup the strip can see; then the tags go; then HTML's
 * own references, which a double-encoded title still carries after XML's are
 * gone. Whitespace collapses, because a title is one line.
 */
export function plainText(raw: string, max: number): string {
	const text = decodeHtmlEntities(stripTags(rawToHtml(raw)));
	return clip(text.replace(/\s+/g, ' ').trim(), max);
}

/**
 * HTML cut to `max` characters **without splitting a tag, an entity or a
 * surrogate pair** (doc 10 §7's 2 KB summaries).
 *
 * An unclosed element left open by the cut is fine: the client's HTML parser
 * closes it, inside DOMPurify, before anything renders. Half a tag is not —
 * `<a hre` at the end of a string is the kind of fragment whose meaning depends
 * on the parser's error recovery, which is not something to hand a sanitiser.
 */
export function truncateHtml(html: string, max: number): string {
	if (html.length <= max) return html;

	let cut = max - 1;
	const open = html.lastIndexOf('<', cut - 1);
	if (open > html.lastIndexOf('>', cut - 1)) cut = open;

	const amp = html.lastIndexOf('&', cut - 1);
	if (amp !== -1 && cut - amp <= 32 && !html.slice(amp, cut).includes(';')) cut = amp;

	if (cut > 0 && isHighSurrogate(html.charCodeAt(cut - 1))) cut -= 1;
	return `${html.slice(0, cut).trimEnd()}…`;
}
