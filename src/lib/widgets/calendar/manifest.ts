import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, calendar row. `multiInstance: false` because a second tile would
 * be the same month with the same events on it — unlike notes or todo, there is
 * no per-instance choice for it to represent.
 *
 * `refresh: midnight` is what rolls "today" over: the ring, the agenda's default
 * day and the observance list are all relative to it, and a deck left open
 * overnight would otherwise still be highlighting yesterday.
 */
const manifest: TpWidgetManifest = {
	id: 'calendar',
	i18nKey: 'widget.calendar',
	category: 'time',
	icon: 'calendar',
	sizes: { min: { w: 2, h: 2 }, max: { w: 6, h: 5 }, default: { w: 3, h: 3 } },
	multiInstance: false,
	refresh: { kind: 'midnight' },
	loadWidget: () => import('./TpCalendarWidget.svelte'),
	loadDetail: () => import('./TpCalendarDetail.svelte')
};

export default manifest;
