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
 * The app shell (doc 17 §2): `files` is static/ (fonts, boot.js, icons, the
 * manifest), `prerendered` is every page SvelteKit rendered — /offline among
 * them, which is the point — and the hashed output those pages load first.
 *
 * Until Week 8 this was all of `build` as well: every tile and detail chunk
 * and ECharts, 269 files and 883 KB gz on a first visit, for widgets the reader
 * may never add. The shell is about 400 KB. What a reader *uses* is kept as it
 * is used (the fetch handler, and KEEP below), and the details of the widgets
 * on their deck are fetched while they are idle (`core/warm.ts`).
 *
 * One prerendered page is left out: /legal/licenses carries every shipped
 * licence, about 150 KB of text a first visit has no use for (doc 16 §5).
 * Offline it falls back to /offline like any page not kept.
 */
const NOT_PRECACHED = new Set(['/legal/licenses']);
const SHELL = [...files, ...prerendered.filter((path) => !NOT_PRECACHED.has(path))];

/** The pages whose own preloads are the shell: the deck, and the two pages a
 *  reader reaches with no connection. */
const SHELL_PAGES = ['/', '/offline', '/settings'];

const OFFLINE_URL = '/offline';

/** Every `<link rel="modulepreload"|"stylesheet">` href in a page. */
function preloads(html: string): string[] {
	const found: string[] = [];
	for (const tag of html.match(/<link\b[^>]*>/g) ?? []) {
		if (!/\brel="(?:modulepreload|stylesheet)"/.test(tag)) continue;
		const href = /\bhref="([^"]+)"/.exec(tag)?.[1];
		if (href !== undefined) found.push(href);
	}
	return found;
}

/**
 * Puts each hashed file in the new cache, from an older version's cache when
 * it is already there: a content hash that did not change is the same bytes,
 * so a deploy only downloads what changed. Never for `files` or pages, whose
 * URLs stay the same while their contents change.
 */
async function keepImmutable(cache: Cache, paths: Iterable<string>): Promise<void> {
	for (const path of paths) {
		if (!path.startsWith('/_app/immutable/')) continue;
		if (await cache.match(path)) continue;
		const carried = await caches.match(path);
		if (carried !== undefined) {
			await cache.put(path, carried);
			continue;
		}
		try {
			const response = await fetch(path);
			if (response.status === 200) await cache.put(path, response);
		} catch {
			// Best effort: a file that will not come now is cached on first use.
		}
	}
}

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(SHELL);

			// The hashed half of the shell is whatever the shell's pages preload,
			// read from the copies just cached rather than fetched again.
			const shell = new Set<string>();
			for (const page of SHELL_PAGES) {
				const response = await cache.match(page);
				if (response === undefined) continue;
				const base = new URL(page, sw.location.href);
				for (const href of preloads(await response.text())) {
					const url = new URL(href, base);
					if (url.origin === sw.location.origin) shell.add(url.pathname);
				}
			}
			await keepImmutable(cache, shell);
		})()
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

/**
 * The update toast sends SKIP_WAITING; nothing else may skip waiting.
 *
 * KEEP carries the hashed files the page loaded before this worker controlled
 * it — on a first visit that is the grid and every tile on the deck, none of
 * which went through the fetch handler below. They come from the HTTP cache,
 * so nothing is downloaded twice. Same-origin `/_app/immutable/` only.
 */
sw.addEventListener('message', (event) => {
	const data = event.data as { type?: unknown; urls?: unknown } | null;
	if (data?.type === 'SKIP_WAITING') {
		void sw.skipWaiting();
	} else if (data?.type === 'KEEP' && Array.isArray(data.urls)) {
		const paths = data.urls.flatMap((value: unknown) => {
			if (typeof value !== 'string') return [];
			try {
				const url = new URL(value, sw.location.href);
				return url.origin === sw.location.origin ? [url.pathname] : [];
			} catch {
				return [];
			}
		});
		event.waitUntil(caches.open(CACHE).then((cache) => keepImmutable(cache, paths)));
	}
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
	// cached on first use rather than precached (doc 17 §2), like every chunk
	// beyond the shell since Week 8. MapLibre's folder is named by version
	// rather than by hash, which is safe only because every deploy opens a
	// fresh cache — and why carrying files forward (`keepImmutable`) is
	// limited to what the new version itself asks for.
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
