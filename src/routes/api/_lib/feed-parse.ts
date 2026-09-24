import { XMLParser } from 'fast-xml-parser';
import type { TpFeed, TpFeedItem } from '$lib/api-types';
import { declaredZone, parseFeedDate } from './feed-date';
import {
	clip,
	decodeXmlEntities,
	escapeHtml,
	plainText,
	rawToHtml,
	truncateHtml
} from './feed-text';

/**
 * RSS 2.0, Atom and RDF (RSS 1.0) into one `TpFeed` (doc 10 §7).
 *
 * Every function here is total: a document it cannot make sense of is `null`
 * — `not-feed` to the endpoint — never a thrown error. A feed is a stranger's
 * XML, and "our normaliser choked on it" is a fact about that feed, not an
 * outage.
 */

/** doc 10 §7 caps each summary at 2 KB of HTML. */
export const FEED_SUMMARY_MAX_CHARS = 2048;

/** Items kept per feed, newest first. A tile shows a handful across ten feeds;
 *  thirty each is a month of most blogs and a day of most newspapers. */
export const FEED_MAX_ITEMS = 30;

const TITLE_MAX_CHARS = 300;
const AUTHOR_MAX_CHARS = 120;
const ID_MAX_CHARS = 512;

/**
 * Elements read **raw** — as the text between the tags, markup and CDATA
 * markers included — because each can carry markup, escaped (`&lt;p&gt;`),
 * inside CDATA, or as real XHTML children, and the parser would otherwise turn
 * the third kind into objects. Titles are here too: Atom allows XHTML titles,
 * and RSS titles arrive in CDATA often enough.
 */
const RAW_ELEMENTS = ['title', 'description', 'content:encoded', 'summary', 'content'];

/** Elements a feed may repeat where the code reads a list. */
const LISTS = new Set(['item', 'entry', 'link', 'author', 'dc:creator']);

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: '@_',
	removeNSPrefix: false,
	/*
	 * Entities are left alone and decoded by `feed-text.ts` instead. Two reasons,
	 * both measured on 5.10.1: its expansion limits are not what its own types say
	 * (`maxTotalExpansions` is `Infinity` at runtime and `1000` in `fxp.d.ts`),
	 * and numeric references stay undecoded unless the deprecated `htmlEntities`
	 * flag is on. A document that declares entities of its own never gets here —
	 * `feed-fetch.ts` refuses it (doc 15 §5).
	 */
	processEntities: false,
	htmlEntities: false,
	// A title of "2026" is text. `strnum` would make it a number.
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
	ignoreDeclaration: true,
	ignorePiTags: true,
	isArray: (name, _path, _leaf, isAttribute) => !isAttribute && LISTS.has(name),
	stopNodes: RAW_ELEMENTS.map((name) => `*.${name}`)
});

type Node = Record<string, unknown>;

function isNode(value: unknown): value is Node {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function listOf(value: unknown): unknown[] {
	if (value === undefined || value === null) return [];
	return Array.isArray(value) ? value : [value];
}

function firstOf(value: unknown): unknown {
	return Array.isArray(value) ? value[0] : value;
}

/** An element's text, whether the parser gave a string or `{ '#text': … }`. */
function textOf(value: unknown): string {
	const node = firstOf(value);
	if (typeof node === 'string') return node;
	if (typeof node === 'number' || typeof node === 'boolean') return String(node);
	if (isNode(node)) return textOf(node['#text']);
	return '';
}

/**
 * A scalar element's value — a link, a guid, a date — with the feed's own
 * escaping undone. `textOf` stays raw on purpose, for the fields `plainText`
 * and `htmlOf` decode themselves. Read raw, a link kept BBC's `&amp;` in every
 * URL: measured through workerd with real feeds on 2026-09-24, after every
 * fixture had passed, because no fixture had an `&` in a link.
 */
function valueOf(value: unknown): string {
	return decodeXmlEntities(textOf(value)).trim();
}

/** An attribute's value, its escaping undone like `valueOf`'s. */
function attrOf(value: unknown, name: string): string | undefined {
	const node = firstOf(value);
	if (!isNode(node)) return undefined;
	const attribute = node[`@_${name}`];
	return typeof attribute === 'string' ? decodeXmlEntities(attribute) : undefined;
}

/** Absolute http(s), resolved against `base`; anything else — `javascript:`,
 *  `mailto:`, garbage — is no link at all. */
function httpUrl(raw: string, base: string): string | null {
	const text = raw.trim();
	if (text === '') return null;
	try {
		const url = new URL(text, base);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}

/** `xml:base` on `node`, resolved against the base it inherits. */
function baseOf(node: unknown, inherited: string): string {
	const declared = attrOf(node, 'xml:base');
	return declared === undefined ? inherited : (httpUrl(declared, inherited) ?? inherited);
}

function titleOf(value: unknown): string {
	return plainText(textOf(value), TITLE_MAX_CHARS);
}

/** A BCP 47 tag, as declared, or `null` — never a guess (doc 14). */
function langOf(raw: string | undefined): string | null {
	const tag = raw?.trim() ?? '';
	return /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(tag) ? tag : null;
}

/**
 * An HTML-bearing element as HTML, cut to size.
 *
 * `fallback` is the type the format assumes when the element names none: RSS
 * `description` is HTML; Atom's text constructs are `text` by default
 * (RFC 4287 §3.1.1), which is escaped here so the reader shows it as text.
 */
function htmlOf(value: unknown, fallback: 'html' | 'text'): string {
	const raw = textOf(value);
	if (raw.trim() === '') return '';

	const type = (attrOf(value, 'type') ?? fallback).toLowerCase();
	let html: string;
	if (type === 'xhtml') html = raw;
	else if (type === 'text' || type === 'text/plain') html = escapeHtml(rawToHtml(raw));
	else html = rawToHtml(raw);

	return truncateHtml(html.trim(), FEED_SUMMARY_MAX_CHARS);
}

function firstHtml(fallback: 'html' | 'text', ...values: unknown[]): string {
	for (const value of values) {
		const html = htmlOf(value, fallback);
		if (html !== '') return html;
	}
	return '';
}

/** RSS `<author>` is an address, often `name@host (Real Name)`: the name when
 *  there is one. */
function rssAuthor(raw: string): string {
	const named = /\(([^)]+)\)\s*$/.exec(raw);
	return plainText(named?.[1] ?? raw, AUTHOR_MAX_CHARS);
}

function itemId(declared: string, link: string | null, title: string, at: number | null): string {
	const id = declared.trim() || link || (title === '' ? '' : `${title}|${at ?? ''}`);
	return clip(id, ID_MAX_CHARS);
}

/** An RSS `<link>`: the first text value; an `atom:link` sibling is a
 *  different key and never read as the page. */
function rssLink(value: unknown, base: string): string | null {
	for (const link of listOf(value)) {
		const href = httpUrl(valueOf(link), base);
		if (href !== null) return href;
	}
	return null;
}

/**
 * The zone a channel writes its own dates in, when it says: the assumption for
 * its items' dates that say nothing. Tuổi Trẻ's `lastBuildDate` ends `GMT+7`
 * and its items read `9/24/2026 9:41:00 PM`; read as UTC they sat seven hours
 * in the future, at the top of every merged list (measured 2026-09-24).
 */
function channelZone(...values: unknown[]): number {
	for (const value of values) {
		const zone = declaredZone(valueOf(value));
		if (zone !== null) return zone;
	}
	return 0;
}

function rssItem(item: Node, base: string, zone: number): TpFeedItem | null {
	const guid = item['guid'];
	// A guid is a permalink unless it says otherwise (RSS 2.0).
	const guidIsLink = (attrOf(guid, 'isPermaLink') ?? 'true').toLowerCase() !== 'false';
	const link = rssLink(item['link'], base) ?? (guidIsLink ? httpUrl(valueOf(guid), base) : null);

	const title = titleOf(item['title']);
	const publishedAt =
		parseFeedDate(valueOf(item['pubDate']), zone) ?? parseFeedDate(valueOf(item['dc:date']), zone);
	const author =
		rssAuthor(textOf(item['author'])) || plainText(textOf(item['dc:creator']), AUTHOR_MAX_CHARS);

	const id = itemId(valueOf(guid), link, title, publishedAt);
	if (id === '') return null;

	return {
		id,
		title,
		link,
		summaryHtml: firstHtml('html', item['description'], item['content:encoded']),
		publishedAt,
		author: author === '' ? null : author
	};
}

function fromRss(rss: Node, base: string): TpFeed | null {
	const channel = firstOf(rss['channel']);
	if (!isNode(channel)) return null;
	const feedBase = baseOf(channel, baseOf(rss, base));
	const zone = channelZone(channel['lastBuildDate'], channel['pubDate'], channel['dc:date']);

	return finish(
		titleOf(channel['title']),
		rssLink(channel['link'], feedBase),
		langOf(valueOf(channel['language']) || valueOf(channel['dc:language'])),
		listOf(channel['item']).map((item) => (isNode(item) ? rssItem(item, feedBase, zone) : null))
	);
}

/** Atom's page link: `rel="alternate"` or no `rel` at all, preferring HTML. */
function atomLink(value: unknown, base: string): string | null {
	const candidates = listOf(value).filter((link) => {
		const rel = attrOf(link, 'rel') ?? 'alternate';
		return rel === 'alternate';
	});
	const html = candidates.find((link) => (attrOf(link, 'type') ?? 'text/html').includes('html'));
	for (const link of html === undefined ? candidates : [html, ...candidates]) {
		const href = httpUrl(attrOf(link, 'href') ?? '', base);
		if (href !== null) return href;
	}
	return null;
}

function atomEntry(entry: Node, feedBase: string, zone: number): TpFeedItem | null {
	const base = baseOf(entry, feedBase);
	const link = atomLink(entry['link'], base);
	const title = titleOf(entry['title']);
	const publishedAt =
		parseFeedDate(valueOf(entry['published']), zone) ??
		parseFeedDate(valueOf(entry['updated']), zone) ??
		parseFeedDate(valueOf(entry['dc:date']), zone);
	const writer = firstOf(entry['author']);
	const author = plainText(isNode(writer) ? textOf(writer['name']) : '', AUTHOR_MAX_CHARS);

	const id = itemId(valueOf(entry['id']), link, title, publishedAt);
	if (id === '') return null;

	return {
		id,
		title,
		link,
		summaryHtml: firstHtml('text', entry['summary'], entry['content']),
		publishedAt,
		author: author === '' ? null : author
	};
}

function fromAtom(feed: Node, base: string): TpFeed {
	const feedBase = baseOf(feed, base);
	const zone = channelZone(feed['updated']);
	return finish(
		titleOf(feed['title']),
		atomLink(feed['link'], feedBase),
		langOf(attrOf(feed, 'xml:lang')),
		listOf(feed['entry']).map((entry) => (isNode(entry) ? atomEntry(entry, feedBase, zone) : null))
	);
}

function rdfItem(item: Node, base: string, zone: number): TpFeedItem | null {
	const link = rssLink(item['link'], base) ?? httpUrl(attrOf(item, 'rdf:about') ?? '', base);
	const title = titleOf(item['title']);
	const publishedAt = parseFeedDate(valueOf(item['dc:date']), zone);
	const author = plainText(textOf(item['dc:creator']), AUTHOR_MAX_CHARS);

	const id = itemId(attrOf(item, 'rdf:about') ?? '', link, title, publishedAt);
	if (id === '') return null;

	return {
		id,
		title,
		link,
		summaryHtml: firstHtml('html', item['description'], item['content:encoded']),
		publishedAt,
		author: author === '' ? null : author
	};
}

/** RSS 1.0: the items are siblings of the channel, not its children. */
function fromRdf(rdf: Node, base: string): TpFeed {
	const channel = firstOf(rdf['channel']);
	const zone = isNode(channel) ? channelZone(channel['dc:date']) : 0;
	return finish(
		titleOf(isNode(channel) ? channel['title'] : undefined),
		isNode(channel) ? rssLink(channel['link'], base) : null,
		langOf(isNode(channel) ? valueOf(channel['dc:language']) : undefined),
		listOf(rdf['item']).map((item) => (isNode(item) ? rdfItem(item, base, zone) : null))
	);
}

/**
 * Newest first, dated entries before undated ones, duplicates dropped, capped.
 *
 * Sorted *before* the cap, because a feed listed oldest-first would otherwise
 * lose exactly the entries a reader opened it for. Undated entries keep the
 * feed's own order after the dated ones; doc 08 §4 has the client order them by
 * fetch time and tag them, which it can only do if they are all together.
 */
function finish(
	title: string,
	link: string | null,
	lang: string | null,
	entries: readonly (TpFeedItem | null)[]
): TpFeed {
	const seen = new Set<string>();
	const unique: TpFeedItem[] = [];
	for (const entry of entries) {
		if (entry === null || seen.has(entry.id)) continue;
		seen.add(entry.id);
		unique.push(entry);
	}

	const dated = unique
		.filter((entry) => entry.publishedAt !== null)
		.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
	const undated = unique.filter((entry) => entry.publishedAt === null);

	return { title, link, lang, items: [...dated, ...undated].slice(0, FEED_MAX_ITEMS) };
}

/**
 * A feed document as a `TpFeed`, or `null` for anything that is not RSS 2.0,
 * Atom or RDF. `base` is the URL the document was finally fetched from, after
 * redirects — what its relative links are relative to.
 */
export function parseFeed(text: string, base: string): TpFeed | null {
	try {
		const doc: unknown = parser.parse(text);
		if (!isNode(doc)) return null;

		const rss = firstOf(doc['rss']);
		if (isNode(rss)) return fromRss(rss, base);
		const atom = firstOf(doc['feed']);
		if (isNode(atom)) return fromAtom(atom, base);
		const rdf = firstOf(doc['rdf:RDF']);
		if (isNode(rdf)) return fromRdf(rdf, base);
		return null;
	} catch {
		return null;
	}
}
