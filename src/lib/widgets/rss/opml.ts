import { addFeed, type TpFeedRefusal } from './service';

/**
 * OPML in and out (doc 08 §4) — the feed list every other reader can export,
 * and the way a reader leaves with theirs.
 *
 * **`DOMParser`, not a dependency.** The browser already has an XML parser, and
 * `fast-xml-parser` is the Worker's: shipping it to the client for a file a
 * reader imports once would cost every visitor its bytes. The consequence is
 * that importing needs a browser, which is where it happens.
 */

/** A feed list is a few kilobytes; a megabyte is no feed list. */
export const OPML_MAX_BYTES = 1024 * 1024;

export interface TpOpmlSkip {
	/** As the file spelled it — shown to the reader, never logged. */
	url: string;
	reason: TpFeedRefusal;
}

export type TpOpmlImport =
	| { ok: true; feeds: string[]; added: number; skipped: TpOpmlSkip[] }
	| { ok: false; reason: 'not-opml' | 'too-large' };

/**
 * Every `xmlUrl` in the document, in document order, however deeply the
 * exporter nested its folders. The attribute is `xmlUrl` in the spec and
 * `xmlurl` in a fair number of exporters; XML attributes are case-sensitive.
 */
function feedUrls(doc: Document): string[] {
	const urls: string[] = [];
	for (const outline of doc.getElementsByTagName('outline')) {
		const url = outline.getAttribute('xmlUrl') ?? outline.getAttribute('xmlurl');
		if (url !== null && url.trim() !== '') urls.push(url.trim());
	}
	return urls;
}

/**
 * Reads an OPML file into this tile's feed list.
 *
 * Every URL goes through `addFeed` — the same rules as the box, so an http
 * feed is asked for over https (plan S8), a second spelling of one already here
 * is a duplicate, and the eleventh is `full`. Nothing is sent anywhere by an
 * import: the feeds are fetched by the tile like any other, through the pacer.
 *
 * **A document that declares entities is refused before it is parsed.** A feed
 * list has no use for them, and an entity is how an XML file turns a few
 * kilobytes into a few gigabytes — the Worker refuses them in feeds for the
 * same reason (doc 15 §5).
 */
export function importOpml(
	text: string,
	existing: readonly string[],
	ownHost?: string
): TpOpmlImport {
	if (new Blob([text]).size > OPML_MAX_BYTES) return { ok: false, reason: 'too-large' };
	if (/<!ENTITY/i.test(text)) return { ok: false, reason: 'not-opml' };

	const doc = new DOMParser().parseFromString(text, 'application/xml');
	if (doc.getElementsByTagName('parsererror').length > 0) return { ok: false, reason: 'not-opml' };
	if (doc.documentElement.nodeName.toLowerCase() !== 'opml')
		return { ok: false, reason: 'not-opml' };

	let feeds = [...existing];
	const skipped: TpOpmlSkip[] = [];

	for (const url of feedUrls(doc)) {
		const edit = addFeed(feeds, url, ownHost);
		if (edit.ok) feeds = edit.feeds;
		else skipped.push({ url, reason: edit.reason });
	}

	return { ok: true, feeds, added: feeds.length - existing.length, skipped };
}

/** One feed as the export needs it. */
export interface TpOpmlFeed {
	url: string;
	title: string;
	/** The feed's own page, when it names one. */
	link: string | null;
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * The tile's feeds as an OPML 2.0 document. Every value is escaped: a feed's
 * title is a stranger's text, and a URL can carry `&` in its query.
 */
export function exportOpml(feeds: readonly TpOpmlFeed[], title: string, now: Date): string {
	const outlines = feeds.map((feed) => {
		const text = escapeXml(feed.title);
		const page = feed.link === null ? '' : ` htmlUrl="${escapeXml(feed.link)}"`;
		return `    <outline type="rss" text="${text}" title="${text}" xmlUrl="${escapeXml(feed.url)}"${page}/>`;
	});

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<opml version="2.0">',
		'  <head>',
		`    <title>${escapeXml(title)}</title>`,
		`    <dateCreated>${now.toUTCString()}</dateCreated>`,
		'  </head>',
		'  <body>',
		...outlines,
		'  </body>',
		'</opml>',
		''
	].join('\n');
}
