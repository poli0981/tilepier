import type { RequestHandler } from './$types';
import type { TpApiMeta, TpFeed, TpFeedPayload } from '$lib/api-types';
import { cacheKey, feedUrlHash } from '$lib/shared-constants';
import { fetchFeedDocument } from '../_lib/feed-fetch';
import { parseFeed } from '../_lib/feed-parse';
import { parseFeedQuery } from '../_lib/feed-query';
import { readCache, ttlSeconds, writeCache, type CachedValue } from '../_lib/kv-cache';
import { checkRateLimit } from '../_lib/ratelimit';
import { fail, isCrossSite, ok } from '../_lib/respond';
import { UpstreamError } from '../_lib/upstream';

/**
 * `GET /api/rss?url=<https URL>` — doc 11 §3, doc 10 §7, doc 15 §5.
 *
 * Not one upstream but a class of them: whatever feed a reader points a tile
 * at. The pipeline is the other endpoints' — validate, rate-gate, KV, upstream,
 * normalise, write, respond — with three differences, each for that reason.
 *
 * **No breaker.** doc 11 §6 counts failures per upstream, and here every feed
 * is its own. One shared `rss` breaker would let three dead feeds switch off
 * every reader's every feed for two minutes. The protection is the KV stale
 * window, the cached "not a feed" answers below, and each client key's own
 * backoff.
 *
 * **"Not a feed" is an answer** (doc 11 §2). An HTML page, a 404, a host that
 * refuses us: cached like a feed, so asking again costs the host nothing, and
 * shown as what it is rather than as an outage. Only what may pass — a
 * timeout, a 429, a 5xx — is `UPSTREAM_DOWN`.
 *
 * **…but never over a feed still held.** A maintenance page served with a 200
 * is "not a feed" for an hour and a feed again after it. Written over the last
 * good copy, it would blank the reader's tile, in KV and — because `swr` stores
 * whatever the fetcher returns — in their Dexie cache too, which is the one
 * thing doc 04 §2 forbids. So while the Worker holds a feed for this URL, fresh
 * or within the stale window, an answer that is not a feed serves that copy as
 * stale instead and is not written.
 */

const FAMILY = 'rss';

/** The `source` every response carries. The host is not it: `meta` is logged
 *  by nothing, but a feed URL can carry a private token, and there is no reason
 *  to hand it anywhere it is not needed. */
const SOURCE = 'rss';

const USER_AGENT = `TilePier/${__TP_BUILD__.version} (+https://tilepier.win)`;

function metaOf(value: CachedValue<TpFeedPayload>, stale: boolean): TpApiMeta {
	return { cachedAt: Math.floor(value.cachedAt / 1000), source: SOURCE, stale };
}

function payloadOf(feed: TpFeed | null): TpFeedPayload {
	return feed === null ? { kind: 'unavailable', reason: 'not-feed' } : { kind: 'feed', feed };
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const query = parseFeedQuery(url);
	if (!query) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const key = cacheKey.rss(await feedUrlHash(query.url));
	const now = Date.now();
	const cached = await readCache<TpFeedPayload>(kv, FAMILY, key, now);
	if (cached.status === 'HIT' && cached.value) {
		return ok(cached.value.payload, metaOf(cached.value, false), 'HIT', ttlSeconds(FAMILY));
	}

	let answer: TpFeedPayload;
	try {
		const document = await fetchFeedDocument(query.url, {
			ownHost: url.hostname,
			userAgent: USER_AGENT
		});
		answer =
			document.kind === 'unavailable'
				? document
				: payloadOf(parseFeed(document.text, document.url));
	} catch (error) {
		if (!(error instanceof UpstreamError)) throw error;
		return cached.value
			? ok(cached.value.payload, metaOf(cached.value, true), 'STALE', ttlSeconds(FAMILY))
			: fail('UPSTREAM_DOWN');
	}

	if (answer.kind === 'unavailable' && cached.value?.payload.kind === 'feed') {
		return ok(cached.value.payload, metaOf(cached.value, true), 'STALE', ttlSeconds(FAMILY));
	}

	// doc 11 §8: persistence rides on waitUntil, so the reader does not wait on it.
	const persist = writeCache(kv, FAMILY, key, answer, SOURCE, now).catch(() => undefined);
	if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(persist);
	else void persist;

	return ok(
		answer,
		{ cachedAt: Math.floor(now / 1000), source: SOURCE, stale: false },
		'MISS',
		ttlSeconds(FAMILY)
	);
};
