import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, toolbox row. `multiInstance: false`: a second tile would be the
 * same three tools with the same recent colours, and doc 07 §7's tile is
 * defined by which tab was last used rather than by anything per-instance.
 *
 * No `refresh`: nothing here changes on its own.
 */
const manifest: TpWidgetManifest = {
	id: 'toolbox',
	i18nKey: 'widget.toolbox',
	category: 'tools',
	icon: 'toolbox',
	sizes: { min: { w: 2, h: 2 }, max: { w: 4, h: 4 }, default: { w: 3, h: 2 } },
	multiInstance: false,
	loadWidget: () => import('./TpToolboxWidget.svelte'),
	loadDetail: () => import('./TpToolboxDetail.svelte')
};

export default manifest;
