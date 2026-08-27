import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, calc row. Single-instance: two calculators on one deck would
 * share one session state and confuse each other, and there is nothing a
 * second one could show that the first cannot.
 */
const manifest: TpWidgetManifest = {
	id: 'calc',
	i18nKey: 'widget.calc',
	category: 'tools',
	icon: 'calculator',
	sizes: { min: { w: 2, h: 2 }, max: { w: 4, h: 4 }, default: { w: 3, h: 3 } },
	multiInstance: false,
	loadWidget: () => import('./TpCalcWidget.svelte'),
	loadDetail: () => import('./TpCalcDetail.svelte')
};

export default manifest;
