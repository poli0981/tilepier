import type { TpSwrStatus } from './swr.svelte';

/**
 * What a tile fed by **several** sources renders as a whole (doc 06 §3).
 *
 * Built for `markets` in Week 5b, when one tile first read two endpoints, and
 * graduated here in Week 6 (doc 03 §1) when `rss` became the second tile to
 * need it — ten feeds is ten sources.
 *
 * **The list as soon as any source has something to show.** Until 5b the
 * markets tile took its status from its one handle, and a watchlist of only
 * stocks — no crypto handle at all — read as `loading` forever: a skeleton over
 * a question nobody was asking. A source the tile does not use is not passed
 * in, and a source that has answered is enough to draw; the others say what
 * they are waiting for in their own rows.
 *
 * With nothing to show from any, the skeleton holds while one is still asking,
 * and after that the most telling failure wins: offline says what to do about
 * it, a rate limit says it will pass, and a plain error says neither.
 *
 * The badge is *not* here, and that is deliberate rather than unfinished. For
 * markets the worst side wins, because two sides are two claims about prices on
 * screen. For rss the same rule would let one flaky feed in ten hang
 * `stale-error` over the whole tile, so each widget keeps its own.
 */
export type TpTileView = 'list' | 'loading' | 'offline' | 'rate-limited' | 'error';

/** One source, as `tileView` needs to see it. */
export interface TpSourceState {
	/** Whether this source has anything on screen right now. */
	shown: boolean;
	status: TpSwrStatus;
}

export function tileView(sources: readonly TpSourceState[]): TpTileView {
	if (sources.some((source) => source.shown)) return 'list';
	if (sources.length === 0) return 'loading';
	if (sources.some((source) => source.status === 'loading' || source.status === 'idle')) {
		return 'loading';
	}
	if (sources.some((source) => source.status === 'offline')) return 'offline';
	if (sources.some((source) => source.status === 'rate-limited')) return 'rate-limited';
	return 'error';
}
