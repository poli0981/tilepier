import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPSTREAM } from '$lib/shared-constants';
import {
	HTML_PAGE,
	RSS_ENTITIES_BEHIND_A_COMMENT,
	RSS_NEWS,
	RSS_WITH_ENTITIES,
	latin1Feed
} from './__fixtures__/feeds';
import { FEED_ACCEPT, decodeFeed, fetchFeedDocument } from './feed-fetch';
import { UpstreamError } from './upstream';

/**
 * doc 15 §5, rule by rule. The fetch is stubbed per URL, so each case says
 * exactly what the host answered and what the guard made of it; the endpoint
 * suite covers what reaches the reader.
 */

type Route = (init: RequestInit) => Response | Promise<Response>;

const calls: { url: string; init: RequestInit }[] = [];

function serve(routes: Record<string, Route>): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
			const url = String(input);
			calls.push({ url, init });
			const route = routes[url];
			if (route === undefined) throw new TypeError(`no route for ${url}`);
			return route(init);
		})
	);
}

const feed =
	(body: string = RSS_NEWS, headers: Record<string, string> = {}): Route =>
	() =>
		new Response(body, {
			status: 200,
			headers: { 'content-type': 'application/rss+xml; charset=utf-8', ...headers }
		});

const redirect =
	(location: string, status = 301): Route =>
	() =>
		new Response(null, { status, headers: { location } });

const status =
	(code: number): Route =>
	() =>
		new Response('nope', { status: code });

const OPTIONS = { ownHost: 'tilepier.win', userAgent: 'TilePier/test (+https://tilepier.win)' };

afterEach(() => {
	calls.length = 0;
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the request', () => {
	it('asks for a feed, names the app, and follows nothing by itself', async () => {
		serve({ 'https://news.example.vn/rss': feed() });

		await fetchFeedDocument('https://news.example.vn/rss', OPTIONS);

		const init = calls[0]?.init;
		expect(init?.redirect).toBe('manual');
		const headers = new Headers(init?.headers);
		expect(headers.get('accept')).toBe(FEED_ACCEPT);
		expect(headers.get('user-agent')).toBe(OPTIONS.userAgent);
		// Nothing of the reader's own request travels: three headers, all ours.
		expect([...headers.keys()].sort()).toEqual(['accept', 'accept-encoding', 'user-agent']);
	});

	it('returns the document and the URL it was finally fetched from', async () => {
		serve({ 'https://news.example.vn/rss': feed() });

		const document = await fetchFeedDocument('https://news.example.vn/rss', OPTIONS);

		expect(document).toEqual({
			kind: 'document',
			text: RSS_NEWS,
			url: 'https://news.example.vn/rss'
		});
	});
});

describe('redirects (doc 15 §5: three, same scheme, every hop checked)', () => {
	it('follows a relative Location, the way Tuổi Trẻ sends one', async () => {
		serve({
			'https://tuoitre.example.vn/rss/tin-moi-nhat.rss': redirect('/home.rss'),
			'https://tuoitre.example.vn/home.rss': feed()
		});

		const document = await fetchFeedDocument(
			'https://tuoitre.example.vn/rss/tin-moi-nhat.rss',
			OPTIONS
		);

		expect(document.kind).toBe('document');
		// The base for the feed's relative links is where it was found.
		expect(document.kind === 'document' && document.url).toBe(
			'https://tuoitre.example.vn/home.rss'
		);
	});

	it('follows three hops and refuses a fourth', async () => {
		const three: Record<string, Route> = {
			'https://a.example.com/1': redirect('https://a.example.com/2', 302),
			'https://a.example.com/2': redirect('https://a.example.com/3', 307),
			'https://a.example.com/3': redirect('https://a.example.com/4', 308),
			'https://a.example.com/4': feed()
		};
		serve(three);
		expect((await fetchFeedDocument('https://a.example.com/1', OPTIONS)).kind).toBe('document');

		serve({ ...three, 'https://a.example.com/4': redirect('https://a.example.com/5') });
		expect(await fetchFeedDocument('https://a.example.com/1', OPTIONS)).toEqual({
			kind: 'unavailable',
			reason: 'too-many-redirects'
		});
	});

	it.each([
		['to http', 'http://a.example.com/feed'],
		['to an address', 'https://127.0.0.1/feed'],
		['to a decimal address', 'https://2130706433/feed'],
		['to a private suffix', 'https://router.home.arpa/feed'],
		['back to this app', 'https://tilepier.win/api/rss?url=x'],
		['to another port', 'https://a.example.com:8080/feed']
	])('refuses a redirect %s, and never asks it', async (_name, location) => {
		serve({ 'https://a.example.com/feed': redirect(location) });

		const document = await fetchFeedDocument('https://a.example.com/feed', OPTIONS);

		expect(document).toEqual({ kind: 'unavailable', reason: 'blocked-redirect' });
		expect(calls).toHaveLength(1);
	});

	it('reads a redirect with no Location as not a feed', async () => {
		serve({ 'https://a.example.com/feed': () => new Response(null, { status: 302 }) });

		expect(await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).toEqual({
			kind: 'unavailable',
			reason: 'not-feed'
		});
	});

	it('runs every hop and the body under one deadline, not one each', async () => {
		serve({
			'https://a.example.com/1': redirect('https://a.example.com/2'),
			'https://a.example.com/2': feed()
		});

		await fetchFeedDocument('https://a.example.com/1', OPTIONS);

		expect(calls).toHaveLength(2);
		expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
		expect(calls[1]?.init.signal).toBe(calls[0]?.init.signal);
	});
});

describe('what the host answered', () => {
	it.each([
		[404, 'gone'],
		[410, 'gone'],
		[401, 'refused'],
		[403, 'refused'],
		[451, 'refused'],
		[400, 'refused']
	])('%i is the answer "%s"', async (code, reason) => {
		serve({ 'https://a.example.com/feed': status(code) });

		expect(await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).toEqual({
			kind: 'unavailable',
			reason
		});
	});

	it.each([429, 500, 502, 503])(
		'%i may pass, so it throws for the endpoint to serve stale',
		async (code) => {
			serve({ 'https://a.example.com/feed': status(code) });

			const error = await fetchFeedDocument('https://a.example.com/feed', OPTIONS).catch(
				(e: unknown) => e
			);

			expect(error).toBeInstanceOf(UpstreamError);
			expect((error as UpstreamError).status).toBe(code);
		}
	);

	it('throws a timeout as a timeout, whether it lands on the request or the body', async () => {
		serve({
			'https://a.example.com/slow-head': () => {
				throw new DOMException('The operation timed out.', 'TimeoutError');
			},
			'https://a.example.com/slow-body': () =>
				new Response(
					new ReadableStream<Uint8Array>({
						start(controller) {
							controller.enqueue(new TextEncoder().encode('<rss><channel>'));
						},
						pull(controller) {
							controller.error(new DOMException('The operation timed out.', 'TimeoutError'));
						}
					}),
					{ headers: { 'content-type': 'application/rss+xml' } }
				)
		});

		for (const url of ['https://a.example.com/slow-head', 'https://a.example.com/slow-body']) {
			const error = await fetchFeedDocument(url, OPTIONS).catch((e: unknown) => e);
			expect((error as UpstreamError).kind, url).toBe('timeout');
		}
	});
});

describe('the body (doc 15 §5: 1 MB, and something that looks like a feed)', () => {
	it('refuses a declared length over the cap without reading it', async () => {
		serve({
			'https://a.example.com/feed': feed(RSS_NEWS, {
				'content-length': String(UPSTREAM.maxResponseBytes + 1)
			})
		});

		expect(await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).toEqual({
			kind: 'unavailable',
			reason: 'too-large'
		});
	});

	it('refuses a body that grows past the cap while it is read', async () => {
		const chunk = new TextEncoder().encode(`<!-- ${'x'.repeat(64 * 1024)} -->`);
		serve({
			'https://a.example.com/feed': () =>
				new Response(
					new ReadableStream<Uint8Array>({
						pull(controller) {
							controller.enqueue(chunk);
						}
					}),
					{ headers: { 'content-type': 'application/rss+xml' } }
				)
		});

		expect(await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).toEqual({
			kind: 'unavailable',
			reason: 'too-large'
		});
	});

	it('refuses an HTML page served with a 200', async () => {
		serve({
			'https://a.example.com/feed': feed(HTML_PAGE, { 'content-type': 'text/html; charset=utf-8' })
		});

		expect(await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).toEqual({
			kind: 'unavailable',
			reason: 'not-feed'
		});
	});

	it('accepts a feed mislabelled as HTML when its root is in the first 512 bytes', async () => {
		serve({ 'https://a.example.com/feed': feed(RSS_NEWS, { 'content-type': 'text/html' }) });

		expect((await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).kind).toBe('document');
	});

	it('refuses a document type that declares entities', async () => {
		serve({ 'https://a.example.com/feed': feed(RSS_WITH_ENTITIES) });

		expect(await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).toEqual({
			kind: 'unavailable',
			reason: 'not-feed'
		});
	});

	it('is not fooled by a root inside a comment before the declaration', async () => {
		serve({ 'https://a.example.com/feed': feed(RSS_ENTITIES_BEHIND_A_COMMENT) });

		expect(await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).toEqual({
			kind: 'unavailable',
			reason: 'not-feed'
		});
	});

	it('lets an article quote <!ENTITY after the root — that is text, not a declaration', async () => {
		const quoting = RSS_NEWS.replace(
			'<p>Mỗi lít giảm vài trăm đồng.</p>',
			'<pre>&lt;!ENTITY x "y"&gt;</pre><!ENTITY'
		);
		serve({ 'https://a.example.com/feed': feed(quoting) });

		expect((await fetchFeedDocument('https://a.example.com/feed', OPTIONS)).kind).toBe('document');
	});
});

describe('decoding (doc 10 §7)', () => {
	it('reads the XML declaration when the header names no charset', () => {
		expect(decodeFeed(latin1Feed(), 'application/rss+xml')).toContain('<title>Café</title>');
	});

	it('lets the header charset win over the declaration', () => {
		const utf8 = new TextEncoder().encode(
			'<?xml version="1.0" encoding="ISO-8859-1"?><rss><channel><title>Café</title></channel></rss>'
		);
		expect(decodeFeed(utf8, 'application/xml; charset=utf-8')).toContain('<title>Café</title>');
	});

	it('lets a BOM win over both, and drops it', () => {
		const text = '<rss><channel><title>Phở</title></channel></rss>';
		const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(text)]);
		expect(decodeFeed(bom, 'application/xml; charset=iso-8859-1')).toBe(text);
	});

	it('falls back to UTF-8 for a label the runtime does not know', () => {
		const text = '<rss><channel><title>Phở</title></channel></rss>';
		expect(
			decodeFeed(new TextEncoder().encode(text), 'application/xml; charset=x-unheard-of')
		).toBe(text);
	});
});
