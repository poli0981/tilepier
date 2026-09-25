import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7's `map` row, checked against the table by `core/registry.test.ts`.
 *
 * **Single-instance**, so the saved places and the one home belong to one tile.
 *
 * **No `refresh`** — nothing on the tile goes stale: tiles are fetched by
 * MapLibre as the view needs them, and the browser caches them (doc 08 §5).
 *
 * **`permissions: ['geolocation']`** for "use my location", which makes doc 06
 * §3's `permission-needed` required for this widget, as it is for weather.
 *
 * **`min` is 2×2, so tier S is unreachable** (doc 13 §3): a map has no one-line
 * rendering.
 */
const manifest: TpWidgetManifest = {
	id: 'map',
	i18nKey: 'widget.map',
	category: 'info',
	icon: 'map',
	sizes: { min: { w: 2, h: 2 }, max: { w: 8, h: 6 }, default: { w: 4, h: 3 } },
	multiInstance: false,
	permissions: ['geolocation'],
	loadWidget: () => import('./TpMapWidget.svelte'),
	loadDetail: () => import('./TpMapDetail.svelte')
};

export default manifest;
