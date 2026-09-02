import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7's `markets` row, and `core/registry.test.ts` parses that table out
 * of the markdown to check this against it — so the two cannot drift.
 *
 * **`min` is 2×2, so tier S is unreachable.** doc 13 §3's tier S is
 * `w <= 2 && h <= 1`, and nothing this widget can be resized to satisfies both.
 * That is one density tier fewer than `currency` had to build, and it is worth
 * saying rather than leaving as a gap in the DoD: a watchlist is a list, and a
 * list has no honest one-line rendering.
 *
 * **`visibleOnly` is the only one in the registry.** doc 06 §7 gives it to this
 * row alone, and until 2026-09-01 the flag was honoured only by accident —
 * `tick()` checked it after already returning for a hidden tab, while
 * `wake('online')` ignored it entirely. A 60 s cadence is the first that makes
 * the difference visible.
 *
 * **No `permissions`**, which is what makes `permission-needed` forbidden
 * rather than merely absent (doc 06 §3).
 */
const manifest: TpWidgetManifest = {
	id: 'markets',
	i18nKey: 'widget.markets',
	category: 'finance',
	icon: 'chart',
	sizes: { min: { w: 2, h: 2 }, max: { w: 6, h: 6 }, default: { w: 3, h: 3 } },
	multiInstance: false,
	refresh: { kind: 'interval', everyMs: 60_000, visibleOnly: true },
	loadWidget: () => import('./TpMarketsWidget.svelte'),
	loadDetail: () => import('./TpMarketsDetail.svelte')
};

export default manifest;
