import type * as MapLibre from 'maplibre-gl';

/**
 * MapLibre GL 6, loaded the one way it works here (Week 6 spike M0, doc 22 §S6).
 *
 * **From its own copy at runtime, never through the bundler.** The vendor
 * plugin (`scripts/vite-maplibre.ts`) puts MapLibre's three modules under
 * `_app/immutable/maplibre-<version>/`, and this imports the main one from
 * there. Its own `import.meta.url` then finds the worker next to it, the worker
 * and the main module share one `maplibre-gl-shared.mjs`, and all of it is
 * same-origin, which is what doc 15 §2's `worker-src 'self'` allows. Bundled,
 * the worker was never emitted: a blank map with a quiet 404.
 *
 * The types still come from the package — `import type` is erased, so it
 * costs no bytes and pulls nothing into a chunk.
 */
export type TpMapLibre = typeof MapLibre;

let loading: Promise<TpMapLibre> | null = null;

/**
 * The module, once per page. A failed load is not cached, so a map that could
 * not load offline can try again when the network is back.
 */
export function loadMapLibre(): Promise<TpMapLibre> {
	loading ??= (import(/* @vite-ignore */ __TP_MAPLIBRE__) as Promise<TpMapLibre>).catch(
		(error: unknown) => {
			loading = null;
			throw error;
		}
	);
	return loading;
}

/**
 * MapLibre 6 requires WebGL2 and throws without it. Asked *before* the
 * 300 KB of map arrive (doc 08 §5: "feature-detect, don't crash"), on a canvas
 * nobody sees, whose context is released at once.
 */
export function webgl2Available(): boolean {
	try {
		const canvas = document.createElement('canvas');
		const context = canvas.getContext('webgl2');
		if (context === null) return false;
		context.getExtension('WEBGL_lose_context')?.loseContext();
		return true;
	} catch {
		return false;
	}
}
