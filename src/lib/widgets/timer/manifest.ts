import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, timer row.
 *
 * No `refresh`: like the clock, a countdown renders from its own local
 * interval because sub-second display accuracy is its job — doc 04 §3's stated
 * exception to the central scheduler. What makes it *correct* is not the
 * interval but `endsAt`, an absolute instant, so a throttled tab still ends on
 * time (doc 07 §2).
 *
 * `permissions` declares `notifications`, which is what doc 06 §3 keys the
 * `permission-needed` state off. The permission itself is requested when the
 * user turns the setting on, never on load.
 */
const manifest: TpWidgetManifest = {
	id: 'timer',
	i18nKey: 'widget.timer',
	category: 'time',
	icon: 'timer',
	sizes: { min: { w: 2, h: 2 }, max: { w: 4, h: 3 }, default: { w: 3, h: 2 } },
	multiInstance: true,
	permissions: ['notifications'],
	loadWidget: () => import('./TpTimerWidget.svelte'),
	loadDetail: () => import('./TpTimerDetail.svelte')
};

export default manifest;
