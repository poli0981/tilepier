import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7's `currency` row, and `core/registry.test.ts` parses that table out
 * of the markdown to check this against it — so the two cannot drift.
 *
 * **`min` is 2×1, which makes tier S reachable.** weather's is 2×2, so this is
 * the first *networked* widget that can be dragged down to a single row, and
 * doc 13 §3's floating-header rule applies to it in full. doc 08 §3's quote
 * post-mortem is the arithmetic: at `cellHeight: 72` a one-row tile has about
 * 34 px of body, which is one line and no controls.
 *
 * **No `permissions`**, which is what makes `permission-needed` forbidden
 * rather than merely absent (doc 06 §3).
 *
 * `loadDetail` arrived one commit after `loadWidget`, because knip is
 * CI-blocking on a thunk pointing at a file that does not exist — the same
 * commit weather's manifest lived through.
 */
const manifest: TpWidgetManifest = {
	id: 'currency',
	i18nKey: 'widget.currency',
	category: 'finance',
	icon: 'coins',
	sizes: { min: { w: 2, h: 1 }, max: { w: 4, h: 4 }, default: { w: 3, h: 2 } },
	multiInstance: false,
	// 12 h, the same number as doc 11 §4's KV TTL. Upstream publishes once a
	// day, so anything shorter is a request that can only produce a HIT.
	refresh: { kind: 'interval', everyMs: 43_200_000 },
	loadWidget: () => import('./TpCurrencyWidget.svelte'),
	loadDetail: () => import('./TpCurrencyDetail.svelte')
};

export default manifest;
