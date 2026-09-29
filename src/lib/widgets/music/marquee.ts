/**
 * Marks a line whose text is wider than its box — doc 09 §2's
 * "marquee-on-overflow" — with `data-overflow` and the distance to travel as
 * `--tp-marquee-shift`. The component's CSS does the moving, and only under
 * `:root[data-motion='ok']`: with reduced motion the line simply ends in an
 * ellipsis (Week 7 plan S15), and the full title is in its `title` attribute.
 *
 * Measured, not guessed: the box changes with the tile's size and the text with
 * the track, so a ResizeObserver and a MutationObserver re-measure both.
 */
export function marquee(node: HTMLElement): () => void {
	function measure(): void {
		const shift = node.scrollWidth - node.clientWidth;
		node.dataset['overflow'] = shift > 1 ? 'true' : 'false';
		node.style.setProperty('--tp-marquee-shift', `${-Math.max(0, shift)}px`);
	}

	const resized = new ResizeObserver(measure);
	resized.observe(node);
	const changed = new MutationObserver(measure);
	changed.observe(node, { childList: true, characterData: true, subtree: true });
	measure();

	return () => {
		resized.disconnect();
		changed.disconnect();
	};
}
