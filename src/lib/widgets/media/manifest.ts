import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7's `media` row, checked against the table by `core/registry.test.ts`
 * — the fifteenth widget, and the last one M7 waits for.
 *
 * **Single-instance**: one video plays at a time, and it plays in the detail
 * (owner decision Q2: picture-in-picture ends when the detail closes), so a
 * second tile could only be a second remote for the same player.
 *
 * **No `refresh`**: nothing is fetched (doc 06 §3's music/media class).
 *
 * **No `permissions`**: a video is opened in the click that picks it, and a
 * recent one asks for its grant in the click that reopens it (Week 7 plan S6),
 * so the tile never waits on one — and doc 06 §3's `permission-needed` does
 * not apply.
 *
 * **`min` is 2×2**, so tier S is unreachable. The tile lays itself out by `w`
 * and `h`, as music does.
 */
const manifest: TpWidgetManifest = {
	id: 'media',
	i18nKey: 'widget.media',
	category: 'media',
	icon: 'film',
	sizes: { min: { w: 2, h: 2 }, max: { w: 8, h: 5 }, default: { w: 4, h: 3 } },
	multiInstance: false,
	loadWidget: () => import('./TpMediaWidget.svelte'),
	loadDetail: () => import('./TpMediaDetail.svelte')
};

export default manifest;
