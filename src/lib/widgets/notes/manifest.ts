import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, notes row. `multiInstance` because a second tile is a second
 * *pinned note* — the parenthetical in that table says so — not a second
 * notebook. The notes themselves are one shared collection in Dexie; only
 * which one a tile shows is per-instance (doc 05 §2).
 */
const manifest: TpWidgetManifest = {
	id: 'notes',
	i18nKey: 'widget.notes',
	category: 'productivity',
	icon: 'note',
	sizes: { min: { w: 2, h: 2 }, max: { w: 6, h: 6 }, default: { w: 3, h: 3 } },
	multiInstance: true,
	loadWidget: () => import('./TpNotesWidget.svelte'),
	loadDetail: () => import('./TpNotesDetail.svelte')
};

export default manifest;
