import { RSS_MAX_FEEDS } from '$lib/shared-constants';

/**
 * The rss tile's settings, as they sit in `tp.layout.v1[].settings` (doc 05 §2)
 * — per instance, because doc 06 §7 makes this widget `multiInstance` for one
 * feed set per tile.
 */
export interface TpRssSettings {
	/**
	 * Canonical feed URLs, through `parseFeedUrl` — the spelling the Worker
	 * insists on, so a stored URL is always one it will answer for. Ordered: the
	 * reader arranges them, and the tile breaks ties between two feeds' items in
	 * this order.
	 */
	feeds: string[];
	/**
	 * doc 08 §4's watermark: when the reader last opened this tile's detail, in
	 * Unix ms. A dated item newer than it carries the unread dot.
	 *
	 * `null` on a tile that has never had a feed. It is set when the first feed
	 * is added rather than left `null` until the first opening, because a `null`
	 * watermark would mark a new feed's whole back catalogue unread — thirty dots
	 * on a tile the reader set up a minute ago.
	 */
	lastOpenedAt: number | null;
}

/** doc 08 §4's "1–10 feeds", from the constant the Worker's docs also cite. */
export const MAX_FEEDS = RSS_MAX_FEEDS;
