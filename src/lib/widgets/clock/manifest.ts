import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, clock row. Imports nothing but types and the thunk — the registry
 * pulls every manifest into the entry chunk, so anything heavy here would ship
 * on first paint.
 *
 * No `refresh`: the tile ticks from its own 1 s interval because sub-second
 * display accuracy is its job, which doc 04 §3 calls out as the explicit
 * exception to the central scheduler.
 */
const manifest: TpWidgetManifest = {
	id: 'clock',
	i18nKey: 'widget.clock',
	category: 'time',
	icon: 'clock',
	sizes: { min: { w: 2, h: 1 }, max: { w: 6, h: 3 }, default: { w: 3, h: 2 } },
	multiInstance: true,
	loadWidget: () => import('./TpClockWidget.svelte'),
	loadDetail: () => import('./TpClockDetail.svelte')
};

export default manifest;
