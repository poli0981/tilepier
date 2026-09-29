/**
 * The internal windowing helper doc 20 §7 names — "lists ≥ 200 rows use the
 * internal windowing helper (music library)" — which did not exist until the
 * music library needed it (Week 7).
 *
 * Fixed-height rows only, which is what makes it this small: which rows a
 * scrolled viewport shows is arithmetic, and the spacers above and below keep
 * the scrollbar the length of the whole list. A library of ten thousand songs
 * renders a few dozen rows at any moment.
 *
 * Pure, so it tests without a DOM; the component owns the scroll listener.
 */

export interface TpWindow {
	/** First row to render. */
	start: number;
	/** One past the last row to render. */
	end: number;
	/** Height of the spacer above the rendered rows, in pixels. */
	before: number;
	/** Height of the spacer below them. */
	after: number;
}

/**
 * The rows to render for a list of `count` rows of `rowHeight` pixels, scrolled
 * to `scrollTop` in a viewport `viewportHeight` tall — with `overscan` rows
 * either side, so a quick scroll does not show the gap before the next frame
 * fills it.
 */
export function windowOf(
	scrollTop: number,
	viewportHeight: number,
	rowHeight: number,
	count: number,
	overscan = 8
): TpWindow {
	if (count <= 0 || !(rowHeight > 0)) return { start: 0, end: 0, before: 0, after: 0 };
	const top = Math.max(0, Number.isFinite(scrollTop) ? scrollTop : 0);
	const height = Math.max(0, Number.isFinite(viewportHeight) ? viewportHeight : 0);
	const first = Math.min(count, Math.max(0, Math.floor(top / rowHeight) - overscan));
	const end = Math.min(count, first + Math.ceil(height / rowHeight) + overscan * 2);
	return { start: first, end, before: first * rowHeight, after: (count - end) * rowHeight };
}
