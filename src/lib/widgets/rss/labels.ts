import { m } from '$lib/paraglide/messages';
import type { TpFeedTrouble } from './service';

/**
 * How a feed's trouble reads, shared by the tile's chips and the detail's
 * feed manager so the two name one problem the same way.
 */

/** The short form, for a chip. */
export function problemText(trouble: TpFeedTrouble): string {
	if (trouble.kind === 'failed') return m['widget.rss.trouble_failed']();
	if (trouble.kind === 'behind') return m['widget.rss.trouble_behind']();
	switch (trouble.reason) {
		case 'not-feed':
			return m['widget.rss.trouble_not_feed']();
		case 'too-large':
			return m['widget.rss.trouble_too_large']();
		case 'gone':
			return m['widget.rss.trouble_gone']();
		case 'refused':
			return m['widget.rss.trouble_refused']();
		case 'blocked-redirect':
			return m['widget.rss.trouble_blocked_redirect']();
		case 'too-many-redirects':
			return m['widget.rss.trouble_too_many_redirects']();
	}
}

/**
 * The long form, naming the feed — a chip's tooltip and accessible name. A
 * feed that is behind says since when, which is the part a reader acts on.
 */
export function troubleText(
	feed: string,
	trouble: TpFeedTrouble,
	ageOf: (at: number) => string
): string {
	if (trouble.kind === 'behind' && trouble.since !== undefined) {
		return m['widget.rss.trouble_behind_label']({ feed, age: ageOf(trouble.since) });
	}
	return m['widget.rss.trouble_label']({ feed, problem: problemText(trouble) });
}
