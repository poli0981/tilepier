import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, quote row. `multiInstance: false`: every instance would show the
 * same line, because the whole idea is that everyone sees the same one.
 *
 * `refresh: midnight` is what makes it the quote of *the day* rather than the
 * quote of whenever the page was last loaded — a deck left open overnight rolls
 * onto the new one by itself.
 */
const manifest: TpWidgetManifest = {
	id: 'quote',
	i18nKey: 'widget.quote',
	category: 'info',
	icon: 'quote',
	sizes: { min: { w: 2, h: 1 }, max: { w: 6, h: 3 }, default: { w: 4, h: 2 } },
	multiInstance: false,
	refresh: { kind: 'midnight' },
	loadWidget: () => import('./TpQuoteWidget.svelte'),
	loadDetail: () => import('./TpQuoteDetail.svelte')
};

export default manifest;
