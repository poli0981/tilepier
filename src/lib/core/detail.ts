import type { Component } from 'svelte';
import { logEntry } from './log-buffer';
import { getManifest } from './registry';
import { isWidgetId, type TpDetailProps, type TpWidgetId } from './types';

/**
 * The detail-expansion handshake (doc 06 §6, doc 13 §5), minus the animation.
 *
 * **What owns what.** Open/closed is not state this module keeps: it is
 * `page.state.detail`, written with SvelteKit's `pushState` and read back
 * through `$app/state`. That is the whole reason doc 06 §6 says "shallow
 * routing" — the browser's Back button then closes the overlay for free,
 * because SvelteKit restores the previous entry's state, and a popstate
 * handler of our own would be a second implementation of history racing the
 * first one. What is left for this module is the part that has nothing to do
 * with history: turning a widget id into a detail component exactly once, and
 * deciding whether something that came back out of `history.state` is a shape
 * we recognise.
 */

/**
 * Travels through `history.state`, so every field has to survive a structured
 * clone and a page restore. Hence plain numbers rather than the `DOMRect` the
 * caller measured: a DOMRect clones, but it does not survive serialisation to
 * the session history store in every browser, and the four numbers are all the
 * FLIP needs.
 */
export interface TpDetailState {
	instanceId: string;
	widgetId: TpWidgetId;
	/** The tile's viewport rect when the user opened it — the FLIP origin.
	 *  Absent when the detail was reached any way other than from a tile. */
	rect?: { x: number; y: number; width: number; height: number };
}

/**
 * Narrows `page.state`, which is `unknown`-shaped by construction: it is
 * restored from a history entry that a previous *build* may have written, and
 * treating that as trusted is the same mistake doc 05 §5 exists to prevent for
 * localStorage. A shape this build does not recognise means no overlay, not a
 * crash on the deck.
 */
export function isDetailState(value: unknown): value is TpDetailState {
	if (typeof value !== 'object' || value === null) return false;
	const state = value as Record<string, unknown>;

	if (typeof state['instanceId'] !== 'string') return false;
	if (!isWidgetId(state['widgetId'])) return false;

	const rect = state['rect'];
	if (rect === undefined) return true;
	if (typeof rect !== 'object' || rect === null) return false;

	const box = rect as Record<string, unknown>;
	return (
		typeof box['x'] === 'number' &&
		typeof box['y'] === 'number' &&
		typeof box['width'] === 'number' &&
		typeof box['height'] === 'number'
	);
}

/**
 * One in-flight import per widget, and one resolved component per widget for
 * the rest of the session.
 *
 * The promise is cached rather than the component, so two tiles of the same
 * widget opened in quick succession share a single network round trip instead
 * of racing two — the same de-dupe rule doc 04 §2 puts on `swr()`, for the same
 * reason. A rejection is cached too, deliberately: a chunk that failed to load
 * has almost certainly failed for a reason that will still be true a second
 * later, and retrying on every click would turn one bad deploy into a request
 * storm. The overlay offers an explicit retry instead, through `forget()`.
 */
const chunks = new Map<string, Promise<Component<TpDetailProps> | null>>();

/** Test seam, and the manifest lookup for production. Injectable for the same
 *  reason `pruneApiCache` takes a database: so the behaviour can be checked
 *  against something other than the real registry. */
type ManifestLookup = typeof getManifest;

export function loadDetailComponent(
	widgetId: string,
	lookup: ManifestLookup = getManifest
): Promise<Component<TpDetailProps> | null> {
	const cached = chunks.get(widgetId);
	if (cached !== undefined) return cached;

	const manifest = lookup(widgetId);
	// No manifest, or a widget that declares no detail: both mean "there is
	// nothing to open", which the caller renders as the tile staying put rather
	// than as an error. doc 06 §1 makes `loadDetail` optional on purpose.
	if (manifest?.loadDetail === undefined) {
		const empty = Promise.resolve(null);
		chunks.set(widgetId, empty);
		return empty;
	}

	const pending = manifest
		.loadDetail()
		.then((module) => module.default)
		.catch((error: unknown) => {
			logEntry('error', `detail chunk for "${widgetId}" failed to load`, {
				src: 'detail',
				error
			});
			throw error;
		});

	chunks.set(widgetId, pending);
	return pending;
}

/** Drops a cached chunk so the next open retries it. The overlay's retry
 *  button, and the seam that keeps tests from leaking a resolved component
 *  from one case into the next. */
export function forgetDetailComponent(widgetId: string): void {
	chunks.delete(widgetId);
}
