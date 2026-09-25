import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7's `rss` row, and `core/registry.test.ts` parses that table out of
 * the markdown to check this against it — so the two cannot drift.
 *
 * **`multiInstance`, one feed set per tile** — doc 06 §7's "per-feed-set". Every
 * feed registers its own refresh under the instance it belongs to
 * (`<instanceId>:rss:<hash>`), so two tiles reading one feed share its `swr`
 * entry without either depending on the other's registration.
 *
 * **`min` is 2×2, so tier S is unreachable** (doc 13 §3's tier S is
 * `w <= 2 && h <= 1`): a list of headlines has no honest one-line rendering.
 *
 * **No `permissions`**, which is what makes `permission-needed` forbidden
 * rather than merely absent (doc 06 §3).
 */
const manifest: TpWidgetManifest = {
	id: 'rss',
	i18nKey: 'widget.rss',
	category: 'info',
	icon: 'rss',
	sizes: { min: { w: 2, h: 2 }, max: { w: 6, h: 6 }, default: { w: 3, h: 4 } },
	multiInstance: true,
	refresh: { kind: 'interval', everyMs: 1_200_000 },
	loadWidget: () => import('./TpRssWidget.svelte'),
	loadDetail: () => import('./TpRssDetail.svelte')
};

export default manifest;
