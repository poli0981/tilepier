/// <reference types="@sveltejs/kit" />
import { build, files, prerendered, version } from '$service-worker';

/**
 * Hand-rolled service worker — doc 17 §2, and the declared fallback for spike
 * S5 (doc 22).
 *
 * vite-plugin-pwa was tried first and lost. Two problems, one fixable and one
 * not, inside the spike's half-day box:
 *
 *  1. `@vite-pwa/sveltekit` builds its precache manifest from SvelteKit's
 *     internal output layout (`client/…`, `prerendered/pages/…`), which
 *     adapter-static preserves and adapter-cloudflare flattens. All 46 entries
 *     404'd, install failed, and `navigator.serviceWorker.ready` simply hung
 *     with nothing thrown. A `manifestTransforms` URL rewrite fixed that.
 *  2. After the fix the worker installed and activated, but its Workbox module
 *     never executed — inspected from inside the worker, `caches` stayed empty
 *     while `define` was present, i.e. the AMD shim's `importScripts` of the
 *     workbox runtime never registered its module. Not resolved in the box.
 *
 * This file sidesteps both, because `$service-worker` hands us the URLs
 * SvelteKit *actually serves* — no path translation, no second runtime to
 * load. Three behaviours, exactly as doc 17 §2 specifies, and nothing more.
 */

/// <reference lib="webworker" />
const sw = self as unknown as ServiceWorkerGlobalScope;

/** Versioned so a deploy replaces the whole cache rather than merging. */
const CACHE = `tp-cache-${version}`;

/**
 * The app shell (doc 17 §2). `build` is the hashed immutable output, `files`
 * is static/ (fonts, boot.js, icons), `prerendered` is the HTML SvelteKit
 * generated — including /offline, which is the point.
 */
const PRECACHE = [...build, ...files, ...prerendered];

const OFFLINE_URL = '/offline';

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
		// No skipWaiting here: doc 17 §2 is explicit that a new version waits
		// for the user. The message handler below is the only way through.
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

/** The update toast calls this; nothing else may skip waiting. */
sw.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// /api/* is never cached here — the client already keeps a Dexie apiCache,
	// and double-caching creates staleness nobody can reason about (doc 17 §2).
	if (url.pathname.startsWith('/api/')) return;

	// Content-hashed output: cache-first is safe and permanent.
	//
	// `/_app/immutable/` as a whole, not only what `build` lists (2026-09-29).
	// `build` comes from the Vite client manifest, and two kinds of output never
	// reach it: the MapLibre modules scripts/vite-maplibre.ts copies in, and the
	// music tag worker, which Vite builds on its own. Both were fetched from the
	// network every time and cached nowhere, so a map or a library scan with no
	// connection failed even after the reader had used it online. They are
	// cached on first use rather than precached; what to precache is the Week 8
	// PWA pass (doc 17 §2). MapLibre's folder is named by version rather than by
	// hash, which is safe only because every deploy opens a fresh cache.
	if (
		build.includes(url.pathname) ||
		files.includes(url.pathname) ||
		url.pathname.startsWith('/_app/immutable/')
	) {
		event.respondWith(
			caches.open(CACHE).then(async (cache) => {
				const hit = await cache.match(request);
				if (hit) return hit;
				const response = await fetch(request);
				// 200 exactly: a 206 is `ok` too, and `cache.put` refuses a partial
				// response. The write is handed to waitUntil so it neither floats
				// unobserved nor delays the response it is copying.
				if (response.status === 200) {
					event.waitUntil(cache.put(request, response.clone()).catch(() => undefined));
				}
				return response;
			})
		);
		return;
	}

	// Navigations: network-first, falling back to the cached page and then to
	// /offline (doc 17 §2).
	if (request.mode === 'navigate') {
		event.respondWith(
			(async () => {
				try {
					const response = await fetch(request);
					if (response.ok) {
						const cache = await caches.open(CACHE);
						cache.put(request, response.clone());
					}
					return response;
				} catch {
					const cache = await caches.open(CACHE);
					return (
						(await cache.match(request)) ??
						(await cache.match(OFFLINE_URL)) ??
						new Response('offline', { status: 503, headers: { 'content-type': 'text/plain' } })
					);
				}
			})()
		);
	}
});

export {};
