import { createReadStream, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Serves MapLibre GL 6 the way it expects to be served (Week 6 spike M0,
 * doc 22 §S6).
 *
 * **The problem.** MapLibre 6 ships as three ES modules — the main module, a
 * worker, and a `maplibre-gl-shared.mjs` both of them import — and finds its
 * worker at runtime with `new URL('./maplibre-gl-worker.mjs', import.meta.url)`.
 * Vite cannot see that URL (it is built from a variable), so a bundled MapLibre
 * ships with no worker at all: the request 404s, no vector tile is ever parsed,
 * and the map is a blank canvas with nothing in the console. And pointing it at
 * a worker on another origin is no escape — it then wraps the worker in a
 * `blob:` URL, which doc 15 §2's `worker-src 'self'` refuses.
 *
 * **The answer.** Copy the three files as they are into
 * `_app/immutable/maplibre-<version>/` and `import()` the main module from
 * there at runtime. Its own `import.meta.url` then resolves the worker next to
 * it, both import the one shared module (downloaded once, from the HTTP cache
 * the second time), everything is same-origin, and the path carries the
 * version, so the immutable cache headers the adapter gives `_app/immutable/`
 * are true. The bundled alternative, `?worker&url`, would ship the shared
 * module twice — about 150 KB gz more for every map user.
 *
 * The copies are not in Vite's manifest, so the service worker does not
 * precache them: MapLibre arrives with the first map, not with the first visit.
 */

const require = createRequire(import.meta.url);

const DIST = dirname(require.resolve('maplibre-gl/dist/maplibre-gl.mjs'));
const VERSION = (
	JSON.parse(readFileSync(require.resolve('maplibre-gl/package.json'), 'utf8')) as {
		version: string;
	}
).version;

/** Where the three modules live, relative to the site root. */
export const MAPLIBRE_DIR = `_app/immutable/maplibre-${VERSION}`;

const FILES = ['maplibre-gl.mjs', 'maplibre-gl-shared.mjs', 'maplibre-gl-worker.mjs'];

export function maplibreVendor(): Plugin {
	return {
		name: 'tp-maplibre-vendor',

		config() {
			return {
				define: {
					// The URL `src/lib/map/maplibre.ts` imports at runtime.
					__TP_MAPLIBRE__: JSON.stringify(`/${MAPLIBRE_DIR}/maplibre-gl.mjs`)
				}
			};
		},

		// Dev: the files are served straight out of node_modules at the same
		// path the build writes them to, so the loader has one URL everywhere.
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				const path = request.url?.split('?')[0] ?? '';
				const file = FILES.find((name) => path === `/${MAPLIBRE_DIR}/${name}`);
				if (file === undefined) {
					next();
					return;
				}
				response.setHeader('content-type', 'text/javascript; charset=utf-8');
				createReadStream(join(DIST, file)).pipe(response);
			});
		},

		// Build: emitted into the client output only. The server build has no use
		// for them, and a Worker bundle that carried 600 KB of map would be paying
		// for something it never runs.
		generateBundle() {
			if (this.environment.name !== 'client') return;
			for (const file of FILES) {
				this.emitFile({
					type: 'asset',
					fileName: `${MAPLIBRE_DIR}/${file}`,
					source: readFileSync(join(DIST, file))
				});
			}
		}
	};
}
