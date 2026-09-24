import type { TpFeedUnavailable } from '$lib/api-types';
import { UPSTREAM, parseFeedUrl } from '$lib/shared-constants';
import { UpstreamError, readCappedBytes, toUpstreamError } from './upstream';

/**
 * The guarded fetch behind `/api/rss` (doc 15 §5).
 *
 * `fetchUpstream` serves every other endpoint and cannot serve this one: it
 * follows redirects on its own, looks at no content type, and decodes
 * everything as UTF-8 — right for JSON from a known host, wrong for a
 * stranger's URL. Before Week 6 doc 15 §5 described a guard no code had; this
 * is it.
 *
 * It either returns the document, returns an **answer** — a reason the URL is
 * not a readable feed, cached like a feed (doc 11 §2) — or throws an
 * `UpstreamError` for a failure that may pass: a timeout, the network, a 429,
 * a 5xx.
 */

/** Feeds first, generic XML next, anything last: a server that negotiates
 *  picks the feed. */
export const FEED_ACCEPT =
	'application/rss+xml, application/atom+xml, application/rdf+xml;q=0.9, application/xml;q=0.8, text/xml;q=0.8, */*;q=0.1';

export type TpFeedDocument =
	| { kind: 'document'; text: string; url: string }
	| { kind: 'unavailable'; reason: TpFeedUnavailable };

export interface TpFeedFetchOptions {
	/** The host this Worker answers on; a redirect there is refused. */
	ownHost?: string;
	userAgent: string;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function unavailable(reason: TpFeedUnavailable): TpFeedDocument {
	return { kind: 'unavailable', reason };
}

async function discard(response: Response): Promise<void> {
	await response.body?.cancel().catch(() => undefined);
}

async function send(url: string, signal: AbortSignal, userAgent: string): Promise<Response> {
	try {
		return await fetch(url, {
			// Every hop is checked here rather than trusted to the runtime: a guard
			// that only saw the first URL would be one `Location:` away from not
			// being a guard.
			redirect: 'manual',
			signal,
			// Nothing of the reader's request is forwarded (doc 15 §5) — no cookie,
			// no pass, no address. A user agent that names the app, because some
			// hosts refuse an empty one and the polite thing is to say who asks.
			headers: { accept: FEED_ACCEPT, 'accept-encoding': 'gzip', 'user-agent': userAgent }
		});
	} catch (error) {
		throw toUpstreamError(error);
	}
}

function resolve(location: string | null, current: string): string | null {
	if (location === null || location.trim() === '') return null;
	try {
		// Tuổi Trẻ answers `Location: /home.rss`: relative, and legal.
		return new URL(location, current).href;
	} catch {
		return null;
	}
}

function bomLabel(bytes: Uint8Array): string | null {
	if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8';
	if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
	if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
	return null;
}

function headerLabel(contentType: string | null): string | null {
	return /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType ?? '')?.[1] ?? null;
}

/** `<?xml … encoding="…"?>`, read from the raw bytes: the declaration is ASCII
 *  in every encoding that can carry one without a BOM. */
function declaredLabel(bytes: Uint8Array): string | null {
	const head = String.fromCharCode(...bytes.subarray(0, 256));
	return /^\s*<\?xml[^>]*\bencoding\s*=\s*["']([\w.:-]+)["']/.exec(head)?.[1] ?? null;
}

/**
 * The document as text, in the encoding it says it is in: its BOM, else the
 * `charset` of its content type, else its XML declaration, else UTF-8.
 *
 * A label the runtime's `TextDecoder` does not know falls back to UTF-8 rather
 * than failing the feed — Vietnamese and most other feeds are UTF-8 anyway, and
 * a few mis-decoded characters are worth more than no feed.
 */
export function decodeFeed(bytes: Uint8Array, contentType: string | null): string {
	const label = bomLabel(bytes) ?? headerLabel(contentType) ?? declaredLabel(bytes) ?? 'utf-8';
	try {
		return new TextDecoder(label).decode(bytes);
	} catch {
		return new TextDecoder().decode(bytes);
	}
}

/** The root element of every format this reads, or a comment to skip past. */
const ROOT_OR_COMMENT = /<!--[\s\S]*?-->|<(?:rss|feed|rdf:RDF)[\s>/]/g;

function rootIndex(text: string): number {
	for (const match of text.matchAll(ROOT_OR_COMMENT)) {
		if (!match[0].startsWith('<!--')) return match.index;
	}
	return -1;
}

/**
 * doc 15 §5's sniff: a content type that says XML, RSS or Atom, or one of the
 * three root elements in the first 512 bytes. HTML error pages and captive
 * portals fail it, which is its whole job.
 */
function looksLikeFeed(text: string, contentType: string | null): boolean {
	if (/xml|rss|atom/i.test(contentType ?? '')) return true;
	const root = rootIndex(text.slice(0, 512));
	return root !== -1;
}

/**
 * A document type that declares entities of its own. No feed needs one, and
 * refusing them outright is simpler than trusting a parser's expansion limits
 * (fast-xml-parser's are not what its types say; `feed-parse.ts` has the
 * measurement). Only the prolog counts — an article *about* XML may quote
 * `<!ENTITY` in its CDATA, and that is text.
 */
function declaresEntities(text: string): boolean {
	const root = rootIndex(text);
	return /<!ENTITY/i.test(root === -1 ? text : text.slice(0, root));
}

async function read(response: Response, url: string): Promise<TpFeedDocument> {
	const declared = Number(response.headers.get('content-length') ?? '0');
	if (declared > UPSTREAM.maxResponseBytes) {
		await discard(response);
		return unavailable('too-large');
	}

	let bytes: Uint8Array;
	try {
		bytes = await readCappedBytes(response);
	} catch (error) {
		const failure = toUpstreamError(error);
		if (failure.kind === 'too-large') return unavailable('too-large');
		throw failure;
	}

	const contentType = response.headers.get('content-type');
	const text = decodeFeed(bytes, contentType);
	if (!looksLikeFeed(text, contentType) || declaresEntities(text)) return unavailable('not-feed');
	return { kind: 'document', text, url };
}

/**
 * Fetches `url` — already canonical, already through `parseFeedUrl` — under
 * doc 15 §5's limits.
 */
export async function fetchFeedDocument(
	url: string,
	options: TpFeedFetchOptions
): Promise<TpFeedDocument> {
	// One deadline for every hop and the body. doc 15 §5's 8 s is for the whole
	// answer; per request, three redirects would buy thirty-two.
	const signal = AbortSignal.timeout(UPSTREAM.timeoutMs);
	let current = url;

	for (let hop = 0; ; hop += 1) {
		const response = await send(current, signal, options.userAgent);

		if (REDIRECTS.has(response.status)) {
			await discard(response);
			if (hop >= UPSTREAM.maxRedirects) return unavailable('too-many-redirects');
			const next = resolve(response.headers.get('location'), current);
			if (next === null) return unavailable('not-feed');
			// The same rule as the first URL, so https → http, a redirect to an
			// address, and one back to this app are all refused here.
			const check = parseFeedUrl(next, options.ownHost);
			if (!check.ok) return unavailable('blocked-redirect');
			current = check.url;
			continue;
		}

		if (response.status === 404 || response.status === 410) {
			await discard(response);
			return unavailable('gone');
		}

		// The host being busy or broken may pass. The status is the host's, and
		// never becomes our own RATE_LIMITED — that would put the reader's global
		// "slow down" notice up for someone else's server (doc 17 §5).
		if (response.status === 429 || response.status >= 500) {
			await discard(response);
			throw new UpstreamError(
				`upstream ${response.status}`,
				'status',
				response.status,
				response.headers
			);
		}

		if (!response.ok) {
			await discard(response);
			return unavailable(response.status >= 400 ? 'refused' : 'not-feed');
		}

		return read(response, current);
	}
}
