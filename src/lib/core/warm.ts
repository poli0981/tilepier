import { whenControlled } from '$lib/core/pwa.svelte';
import { getManifest } from '$lib/core/registry';
import type { TpWidgetId } from '$lib/core/types';

/**
 * Fetches the detail chunks of the widgets on the deck while the reader is
 * idle (doc 17 §2), so that the service worker keeps them and a detail never
 * opened still opens with no connection.
 *
 * The precache is the shell only since Week 8. Tiles are kept as they load;
 * a detail's chunk loads when it is first opened — which, offline, is too
 * late. This closes that gap for the widgets a reader actually has, without
 * the old cost of precaching all fifteen for everyone.
 *
 * Only once a worker controls the page (before that, a fetch goes around it
 * and nothing is kept), only online, never under Save-Data, one chunk at a
 * time, and each widget once per page. A failed load is left for the detail
 * to retry when it is opened.
 */
const warmed = new Set<TpWidgetId>();

function idle(): Promise<void> {
	return new Promise((resolve) => {
		if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve());
		else setTimeout(resolve, 1_000);
	});
}

function allowed(): boolean {
	const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
	return navigator.onLine && connection?.saveData !== true;
}

export function warmDetails(ids: Iterable<TpWidgetId>): void {
	const pending = [...new Set(ids)].filter((id) => !warmed.has(id));
	if (pending.length === 0) return;
	for (const id of pending) warmed.add(id);

	void whenControlled()
		.then(idle)
		.then(async () => {
			for (const id of pending) {
				if (!allowed()) return;
				try {
					await getManifest(id)?.loadDetail?.();
				} catch {
					// The detail retries on open; nothing here depends on it.
				}
			}
		});
}
