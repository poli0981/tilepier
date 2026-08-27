import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, todo row. `multiInstance` because a second tile is a second
 * *list* on the deck — that table's parenthetical says so — not a second set
 * of lists. The lists themselves are one shared collection in Dexie (doc 05
 * §3); only which one a tile shows is per-instance.
 */
const manifest: TpWidgetManifest = {
	id: 'todo',
	i18nKey: 'widget.todo',
	category: 'productivity',
	icon: 'check',
	sizes: { min: { w: 2, h: 2 }, max: { w: 4, h: 6 }, default: { w: 3, h: 3 } },
	multiInstance: true,
	loadWidget: () => import('./TpTodoWidget.svelte'),
	loadDetail: () => import('./TpTodoDetail.svelte')
};

export default manifest;
