import type { TpWidgetId } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';

/**
 * The name and one-line description the drawer card and the tile header read
 * (doc 13 §4, doc 06 §1).
 *
 * These are not manifest fields on purpose. A manifest stays pure data so that
 * tests and `scripts/i18n-check.mjs` can read it without pulling in the whole
 * Paraglide graph; the message references live here instead, and `i18n:check`
 * asserts every registered manifest has both keys in both locales.
 */
export interface TpWidgetLabels {
	title: () => string;
	blurb: () => string;
}

const LABELS: Partial<Record<TpWidgetId, TpWidgetLabels>> = {
	clock: {
		title: () => m['widget.clock.title'](),
		blurb: () => m['widget.clock.blurb']()
	}
};

/** Undefined for a widget that has not been built yet — the registry only
 *  lists what exists, so in practice every registered id resolves. */
export function widgetLabels(id: TpWidgetId): TpWidgetLabels | undefined {
	return LABELS[id];
}
