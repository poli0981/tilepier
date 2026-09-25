import type {
	TpApiMeta,
	TpFeed,
	TpFeedItem,
	TpFeedPayload,
	TpFeedUnavailable,
	TpFeedUrlRejection
} from '$lib/api-types';
import { fetchEnvelope, TpApiError } from '$lib/core/api';
import { swr, type TpSwrFetcher, type TpSwrHandle } from '$lib/core/swr.svelte';
import type { TpDb } from '$lib/core/storage/db';
import type { TpSourceState } from '$lib/core/tile-view';
import {
	CACHE_POLICY,
	RATE_LIMIT,
	ZONE_RATE_LIMIT,
	cacheKey,
	parseFeedUrl
} from '$lib/shared-constants';
import { createPacer } from './pacing';
import { MAX_FEEDS, type TpRssSettings } from './types';

/**
 * The rss tile's data layer (doc 08 §4).
 *
 * **One `swr` source per feed**, keyed by the hash of its canonical URL
 * (`rss:v1:<sha-256>`, doc 11 §4) — the same key the Worker's KV uses. Not one
 * request for the whole set: adding or dropping a feed keeps every other feed's
 * cache, a feed read by two tiles is one entry, the edge caches each feed by
 * its own URL for everyone who reads it, and a feed that is down is one source
 * in `stale-error` rather than a tile's worth of refetching (doc 11 §3).
 *
 * The price of that is up to ten requests a tile, which is what the pacer below
 * is for.
 *
 * **Feed URLs are never logged.** A private feed carries its token in the URL,
 * and the log buffer rides along with a bug report (doc 18 §4). Everything that
 * names a feed to the rest of the app — the `swr` key, the scheduler id and
 * label — names its hash.
 *
 * Pure but for `feedSource`, so every decision the tile makes is testable in the
 * node project without a DOM.
 */

/** What the tile's `swr` entry for one feed holds: the envelope's data and meta. */
export interface TpFeedReading {
	payload: TpFeedPayload;
	meta: TpApiMeta;
}

/**
 * doc 06 §7: `interval 1200 s`. The manifest row and the per-feed registrations
 * are the same fact, and `service.test.ts` holds them to each other.
 */
export const RSS_CADENCE = { kind: 'interval', everyMs: 1_200_000 } as const;

/* ──────────────────────────────────────────────────────────────── settings */

/**
 * Reads the tile's settings bag, failing closed (doc 05 §5): anything that is
 * not a feed URL this build would send is dropped rather than kept to fail on
 * every refresh, a URL stored in another spelling is re-spelled, and the list
 * stops at `MAX_FEEDS` however long a hand-edited layout made it.
 */
export function readSettings(bag: Record<string, unknown>): TpRssSettings {
	const feeds: string[] = [];
	const stored = bag['feeds'];

	if (Array.isArray(stored)) {
		for (const value of stored) {
			if (typeof value !== 'string') continue;
			const check = parseFeedUrl(value);
			if (!check.ok || feeds.includes(check.url)) continue;
			feeds.push(check.url);
			if (feeds.length === MAX_FEEDS) break;
		}
	}

	const at = bag['lastOpenedAt'];
	const lastOpenedAt = typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null;

	return { feeds, lastOpenedAt };
}

/* ─────────────────────────────────────────────────────── adding a feed */

export type TpFeedRefusal = TpFeedUrlRejection | 'duplicate' | 'full';

export type TpFeedEdit =
	{ ok: true; url: string; feeds: string[] } | { ok: false; reason: TpFeedRefusal };

/**
 * What a person pastes, as the URL to ask for.
 *
 * A bare `example.com/feed` gains `https://`, and an `http://` URL — most of
 * what an old OPML file holds — is asked for over https instead (plan S8).
 * doc 15 §5 allows nothing but https, so the alternative to upgrading is
 * refusing, and most hosts that published an http feed a decade ago serve the
 * same path over https now. When one does not, the feed says so in its own
 * chip rather than the box refusing a URL the reader can see is fine.
 */
export function feedInput(raw: string): string {
	const text = raw.trim();
	if (text === '') return text;
	if (/^http:\/\//i.test(text)) return `https://${text.slice('http://'.length)}`;
	if (!/^[a-z][a-z\d+.-]*:/i.test(text)) return `https://${text.replace(/^\/+/, '')}`;
	return text;
}

/**
 * Adds a feed to a tile's list, or says why not.
 *
 * `ownHost` is `location.hostname`: the Worker refuses a feed on the host it is
 * answering on, and saying so here puts the reason in the box rather than in a
 * chip after a round trip.
 */
export function addFeed(feeds: readonly string[], raw: string, ownHost?: string): TpFeedEdit {
	const check = parseFeedUrl(feedInput(raw), ownHost);
	if (!check.ok) return check;
	if (feeds.includes(check.url)) return { ok: false, reason: 'duplicate' };
	if (feeds.length >= MAX_FEEDS) return { ok: false, reason: 'full' };
	return { ok: true, url: check.url, feeds: [...feeds, check.url] };
}

export function removeFeed(feeds: readonly string[], url: string): string[] {
	return feeds.filter((feed) => feed !== url);
}

/** One place up (`-1`) or down (`1`); a move off either end is no move. */
export function moveFeed(feeds: readonly string[], url: string, delta: -1 | 1): string[] {
	const from = feeds.indexOf(url);
	const to = from + delta;
	if (from < 0 || to < 0 || to >= feeds.length) return [...feeds];
	const next = [...feeds];
	next.splice(from, 1);
	next.splice(to, 0, url);
	return next;
}

/* ──────────────────────────────────────────────────────────────── sources */

/** `GET /api/rss?url=<canonical>` — the spelling `parseFeedQuery` insists on. */
export function feedRequestUrl(url: string): string {
	return `/api/rss?${new URLSearchParams({ url }).toString()}`;
}

/**
 * rss's share of doc 11 §7's two per-IP windows: half of each, so the rest of
 * the deck — the weather, the prices, a search box being typed into — always
 * has room beside a cold deck of feeds. Two at a time and half a second apart
 * on top of that, so ten feeds arrive over a few seconds rather than as one
 * burst.
 */
export const feedPacer = createPacer({
	concurrency: 2,
	gapMs: 500,
	windows: [
		{ limit: RATE_LIMIT.maxPerBucket / 2, ms: RATE_LIMIT.bucketMs },
		{ limit: ZONE_RATE_LIMIT.maxPerWindow / 2, ms: ZONE_RATE_LIMIT.windowMs }
	]
});

/**
 * Every request for a feed waits its turn — the first read, a scheduled
 * refresh and a retry alike, because they all reach the network through here.
 * A 429 pauses the queue for as long as it names, or one limiter bucket when it
 * names nothing.
 */
function feedFetcher(url: string): TpSwrFetcher<TpFeedReading> {
	const request = feedRequestUrl(url);

	return async (signal) => {
		const release = await feedPacer.acquire(signal);
		try {
			const result = await fetchEnvelope<TpFeedPayload>(request, signal);
			return { payload: result.data, meta: result.meta };
		} catch (error) {
			if (error instanceof TpApiError && error.code === 'RATE_LIMITED') {
				feedPacer.pause((error.retryAfterS ?? RATE_LIMIT.bucketMs / 1000) * 1000);
			}
			throw error;
		} finally {
			release();
		}
	};
}

/**
 * Subscribes to one feed. `hash` is `feedUrlHash(url)`, worked out by the tile
 * before it asks — it is async, and a source cannot exist without its key.
 *
 * The window is the Worker's KV TTL, which is the floor (doc 04 §2): a shorter
 * one would revalidate into a guaranteed HIT.
 */
export function feedSource(url: string, hash: string, target?: TpDb): TpSwrHandle<TpFeedReading> {
	const options = { ttlMs: CACHE_POLICY.rss.ttlMs };
	const key = cacheKey.rss(hash);
	const fetcher = feedFetcher(url);

	return target === undefined
		? swr<TpFeedReading>(key, fetcher, options)
		: swr<TpFeedReading>(key, fetcher, options, target);
}

/* ──────────────────────────────────────────────────────────────── views */

/** One feed, as the tile and the detail need to see it. */
export interface TpFeedView extends TpSourceState {
	url: string;
	/** The feed on screen, or `null` — nothing yet, an answer that it is not a
	 *  feed, or a copy past `swr`'s hard ceiling. */
	feed: TpFeed | null;
	/** The Worker's answer that this URL is not a feed anyone can read. */
	unavailable: TpFeedUnavailable | null;
	/** The Worker served its held copy because the feed's own host is failing
	 *  (doc 11 §4) — which `swr`, seeing a 200, cannot tell. */
	servedStale: boolean;
	/** When the Worker fetched what is on screen from the feed's host (Unix ms). */
	fetchedAt: number | undefined;
	/** When this device last had an answer about it (Unix ms). */
	cachedAt: number | undefined;
}

type TpHandleView = Pick<TpSwrHandle<TpFeedReading>, 'data' | 'status' | 'cachedAt'>;

export function feedView(url: string, handle: TpHandleView): TpFeedView {
	const reading = handle.data;
	const payload = reading?.payload;
	const feed = payload?.kind === 'feed' ? payload.feed : null;

	return {
		url,
		feed,
		unavailable: payload?.kind === 'unavailable' ? payload.reason : null,
		// A feed with no items still answered: the tile lists nothing and says
		// so, which is a different thing from failing.
		shown: feed !== null,
		status: handle.status,
		servedStale: reading?.meta.stale === true,
		fetchedAt: reading === undefined ? undefined : reading.meta.cachedAt * 1000,
		cachedAt: handle.cachedAt
	};
}

/** The host a feed is served from, without the `www.` nobody reads. */
export function hostOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}

/** What a feed is called: its own title, or its host when it gives none. */
export function feedName(view: Pick<TpFeedView, 'url' | 'feed'>): string {
	const title = view.feed?.title.trim() ?? '';
	return title === '' ? hostOf(view.url) : title;
}

/**
 * The letter a feed is shown by (doc 08 §4, cut from a favicon in the Week 6
 * plan): the first letter or digit of its name, upper-cased for the reader's
 * locale. A favicon would have been a request to a stranger's host for every
 * feed on every deck, which is exactly what doc 15 §2's `img-src` forbids.
 */
export function monogramOf(name: string, locale: string): string {
	const first = Array.from(name.replace(/^[^\p{L}\p{N}]+/u, ''))[0];
	return first === undefined ? '#' : first.toLocaleUpperCase(locale);
}

/**
 * A link a browser may be sent to, or `null`.
 *
 * The Worker already keeps only http(s) (`feed-parse.ts`), and this checks
 * again because the payload came out of Dexie as much as off the network, and
 * an `href` is the one place in the tile a stranger's string gets to act.
 */
export function openableLink(link: string | null): string | null {
	if (link === null) return null;
	try {
		const url = new URL(link);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}

/* ────────────────────────────────────────────────────── the merged list */

/** One line of the merged list. */
export interface TpRssEntry {
	/** Unique across the tile: two feeds may share an item id. */
	key: string;
	feedUrl: string;
	feedName: string;
	/** The feed's declared language, for the title's `lang` (doc 14); `''`
	 *  says "unknown" rather than letting the page's language claim it. */
	lang: string;
	item: TpFeedItem;
	link: string | null;
	/** What the list is ordered by, and the time the line shows — see
	 *  `mergeItems`. */
	at: number;
	/** doc 08 §4's "undated" tag. */
	dated: boolean;
	unread: boolean;
}

/**
 * Every feed's items as one list, newest first (doc 08 §4).
 *
 * **Undated items sort by when their feed was fetched** and are never unread —
 * doc 08 §4's "order by fetch time with an undated tag". Compared with the
 * watermark instead, an undated item would come back as new on every refetch,
 * forever (plan S9).
 *
 * **A date in the future is read as the fetch time.** A feed whose clock or
 * zone is wrong would otherwise pin its items to the top of the list and keep
 * them unread after every opening.
 *
 * **The same article in two feeds is listed once**, under the feed that comes
 * first — overlapping section feeds from one publisher are the common case.
 *
 * Ties go to the reader's feed order, then to each feed's own order.
 */
export function mergeItems(
	views: readonly TpFeedView[],
	watermark: number | null,
	limit: number
): TpRssEntry[] {
	const rows: { entry: TpRssEntry; feedIndex: number; itemIndex: number }[] = [];
	const seenLinks = new Set<string>();

	views.forEach((view, feedIndex) => {
		const feed = view.feed;
		if (feed === null) return;

		const name = feedName(view);
		// Always there when `feed` is: both come off the same reading.
		const fetchedAt = view.fetchedAt ?? 0;

		feed.items.forEach((item, itemIndex) => {
			const link = openableLink(item.link);
			if (link !== null) {
				if (seenLinks.has(link)) return;
				seenLinks.add(link);
			}

			const dated = item.publishedAt !== null;
			const at = Math.min(item.publishedAt ?? fetchedAt, fetchedAt);
			rows.push({
				entry: {
					key: `${view.url}\n${item.id}`,
					feedUrl: view.url,
					feedName: name,
					lang: feed.lang ?? '',
					item,
					link,
					at,
					dated,
					unread: dated && watermark !== null && at > watermark
				},
				feedIndex,
				itemIndex
			});
		});
	});

	rows.sort(
		(a, b) => b.entry.at - a.entry.at || a.feedIndex - b.feedIndex || a.itemIndex - b.itemIndex
	);
	return rows.slice(0, limit).map((row) => row.entry);
}

/* ────────────────────────────────────────────────────── per-feed trouble */

/**
 * What is wrong with one feed, for its own chip (doc 08 §4: "dead feed →
 * per-feed error chip, others keep working").
 */
export type TpFeedTrouble =
	/** The Worker fetched it and it is not a feed anyone can read. */
	| { kind: 'unavailable'; reason: TpFeedUnavailable }
	/** Nothing on screen, and the last attempt failed. */
	| { kind: 'failed' }
	/** On screen but not current: the Worker is serving its held copy because
	 *  the feed's host is failing, or this device could not refresh it. */
	| { kind: 'behind'; since: number | undefined };

export function troubleOf(view: TpFeedView): TpFeedTrouble | null {
	if (view.feed === null) {
		if (view.unavailable !== null) return { kind: 'unavailable', reason: view.unavailable };
		const failed =
			view.status === 'error' || view.status === 'offline' || view.status === 'rate-limited';
		return failed ? { kind: 'failed' } : null;
	}

	if (view.servedStale || refreshFailed(view)) return { kind: 'behind', since: view.fetchedAt };
	return null;
}

/**
 * The last refresh of a feed on screen did not land. `error` is in the list
 * for the one code that keeps it with data present — `BAD_REQUEST`, a stored
 * URL the Worker has since stopped accepting.
 */
function refreshFailed(view: TpFeedView): boolean {
	return view.status === 'stale-error' || view.status === 'rate-limited' || view.status === 'error';
}

/* ─────────────────────────────────────────────────────── the host badge */

/**
 * How old the whole tile's data has to be before the header calls it stale:
 * two refresh cycles, so the badge means a refresh was *missed*.
 *
 * Not `swr`'s own `stale`, which starts the moment an entry passes its window —
 * and with the window equal to the cadence, that moment is every refresh. Ten
 * feeds waiting their turn in the pacer would flash the badge on and off every
 * twenty minutes, saying nothing each time.
 */
export const STALE_AFTER_MS = 2 * RSS_CADENCE.everyMs;

export type TpRssBadge = { kind: 'offline' | 'stale-error' | 'stale'; at: number | undefined };

/**
 * doc 13 §7's header badge, by rss's own rule rather than markets'.
 *
 * markets raises its worst side, because its two sides are two claims about
 * prices on screen. Here that would let one flaky feed in ten hang
 * `stale-error` over the whole tile while the other nine are current — so a
 * feed's own trouble goes to its chip, and the header speaks only for the tile:
 *
 * - **offline** as soon as any feed on screen found the network gone, since
 *   that is the device, not the feed;
 * - **stale-error** when *every* feed on screen failed its last refresh — the
 *   tile as a whole is not being kept current, and retry is for all of it;
 * - **stale** when every feed on screen is two cycles old — a laptop that
 *   slept, until the refreshes it missed have run.
 *
 * `at` is the oldest of the ages involved, since the badge is a claim about
 * all of them.
 */
export function rssBadge(views: readonly TpFeedView[], now: number): TpRssBadge | null {
	const shown = views.filter((view) => view.feed !== null);
	if (shown.length === 0) return null;

	const oldest = (): number | undefined => {
		let at: number | undefined;
		for (const view of shown) {
			if (view.cachedAt !== undefined && (at === undefined || view.cachedAt < at)) {
				at = view.cachedAt;
			}
		}
		return at;
	};

	if (shown.some((view) => view.status === 'offline')) return { kind: 'offline', at: undefined };

	if (shown.every(refreshFailed)) return { kind: 'stale-error', at: oldest() };

	const behind = (view: TpFeedView) =>
		view.cachedAt !== undefined && now - view.cachedAt > STALE_AFTER_MS;
	if (shown.every(behind)) return { kind: 'stale', at: oldest() };

	return null;
}
