import type { TpWidgetManifest } from '$lib/core/registry';

/**
 * doc 06 §7's `music` row, checked against the table by `core/registry.test.ts`.
 *
 * **Single-instance** (doc 06 §1's own example): there is one library, one
 * folder grant and one audio element, and a second tile could only be a second
 * remote for the same player.
 *
 * **No `refresh`** — nothing here is fetched, so there is nothing to go stale
 * and no scheduler entry (doc 06 §3's music/media class: loading, ready, empty,
 * error).
 *
 * **`permissions: ['fsa']`**, the only manifest to declare it, which makes doc
 * 06 §3's `permission-needed` required: a folder library the browser will not
 * read again until the reader allows it (doc 09 §2's "Re-link library").
 *
 * **`min` is 2×1**, so tier S is reachable. The tile lays itself out by `w`
 * and `h` rather than by tier name, because the host's tier rule is broader
 * than doc 13 §3's (recorded there, 2026-09-29).
 */
const manifest: TpWidgetManifest = {
	id: 'music',
	i18nKey: 'widget.music',
	category: 'media',
	icon: 'music',
	sizes: { min: { w: 2, h: 1 }, max: { w: 6, h: 3 }, default: { w: 4, h: 2 } },
	multiInstance: false,
	permissions: ['fsa'],
	loadWidget: () => import('./TpMusicWidget.svelte'),
	loadDetail: () => import('./TpMusicDetail.svelte')
};

export default manifest;
