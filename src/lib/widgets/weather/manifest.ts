import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7, weather row. `multiInstance: true` is "per-place": a second tile
 * is a second city, and two tiles on the *same* city cost one request between
 * them because `swr` and the scheduler are both keyed on the data key rather
 * than the instance (doc 04 §3).
 *
 * `interval 600 s` matches doc 08 §1's "scheduler 600 s; client ttl 600 s", and
 * the widget re-declares it through `useRefresh` — `TpWidgetHost` deliberately
 * does not register a manifest's cadence (doc 06 §5, and the note in
 * `core/refresh.svelte.ts`). `registry.test.ts` parses doc 06 §7's markdown and
 * asserts this row against it, so the two cannot drift.
 *
 * `permissions: ['geolocation']` for doc 08 §1's "use my location", which makes
 * `permission-needed` required rather than forbidden (doc 06 §3).
 *
 * `loadDetail` arrives with the panel — the field is optional, and knip is
 * CI-blocking on a thunk pointing at a file that does not exist, so the tile
 * shipped without one for exactly one commit.
 */
const manifest: TpWidgetManifest = {
	id: 'weather',
	i18nKey: 'widget.weather',
	category: 'info',
	icon: 'cloud',
	sizes: { min: { w: 2, h: 2 }, max: { w: 6, h: 4 }, default: { w: 3, h: 2 } },
	multiInstance: true,
	refresh: { kind: 'interval', everyMs: 600_000 },
	permissions: ['geolocation'],
	loadWidget: () => import('./TpWeatherWidget.svelte'),
	loadDetail: () => import('./TpWeatherDetail.svelte')
};

export default manifest;
