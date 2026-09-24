import { parseFeedUrl } from '$lib/shared-constants';

/**
 * `GET /api/rss?url=<https URL>` (doc 11 §3). In `_lib` for the reason
 * `crypto-query.ts` gives: SvelteKit refuses non-handler exports from a
 * `+server.ts`, and only at build time.
 */

export interface TpFeedQuery {
	/** Canonical, through `parseFeedUrl`. */
	url: string;
}

/**
 * Exactly one `url`, **already in its canonical spelling**, or nothing.
 *
 * Canonical-or-refused rather than canonicalised here, for doc 11 §3's reason
 * about allowlists: the response is cached by URL at the edge, and two
 * spellings of one feed would be two edge entries for one answer. The client
 * sends what `parseFeedUrl` returns, so a URL in any other spelling did not come
 * from this app. The KV key is a hash of the canonical form either way, so the
 * refusal costs nothing but the second spelling.
 *
 * The host the request arrived on is this app's own, and refused as a feed:
 * a Worker fetching itself is a loop, not a feed.
 */
export function parseFeedQuery(url: URL): TpFeedQuery | null {
	const values = url.searchParams.getAll('url');
	if (values.length !== 1) return null;

	const raw = values[0] ?? '';
	const check = parseFeedUrl(raw, url.hostname);
	return check.ok && check.url === raw ? { url: check.url } : null;
}
