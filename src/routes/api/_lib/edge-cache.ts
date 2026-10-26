import { waitUntil } from 'cloudflare:workers';

/**
 * The edge cache in front of `/api/*` (doc 11 §2): `caches.default` in the
 * Cloudflare location that answered, keeping each cacheable GET for the max-age
 * its response states.
 *
 * adapter-cloudflare did this until its version 8, in the worker it generates,
 * before SvelteKit or any hook ran. Version 8 dropped it, so `hooks.server.ts`
 * calls these two at the same point — first thing for an `/api` request, before
 * the gate — with the rules the adapter took from worktop's `Cache`, which
 * doc 11 §2 and the gate's reasoning (`gate.ts`) were written against:
 *
 * - a request that says `cache-control: no-cache` is never answered from it;
 * - a HEAD is answered from its GET's entry, with no body;
 * - only a GET is stored, and only a response that states its own caching: a
 *   `cache-control` that is not private, no-cache or no-store, a status below
 *   400 that a shared cache may keep, and no `Vary: *`.
 *
 * One rule is stricter than the adapter's: a response that sets a cookie is not
 * stored at all, where worktop stored it with the cookie stripped. Nothing here
 * sets one (doc 16), and a cookie never travels from one reader's answer to
 * the next.
 */

/** Below 400, the statuses worktop let a cache keep. */
const STORABLE: ReadonlySet<number> = new Set([200, 203, 204, 300, 301]);

/** Absent outside a Worker: in unit tests, and while pages prerender. */
function edge(): Cache | undefined {
	return (globalThis as { caches?: { default?: Cache } }).caches?.default;
}

/** The stored answer to `request`, as a copy whose headers can be changed. */
export async function lookup(request: Request): Promise<Response | undefined> {
	const cache = edge();
	if (cache === undefined) return undefined;
	if (request.method !== 'GET' && request.method !== 'HEAD') return undefined;
	if ((request.headers.get('cache-control') ?? '').includes('no-cache')) return undefined;

	const head = request.method === 'HEAD';
	const hit = await cache.match(head ? new Request(request, { method: 'GET' }) : request);
	if (hit === undefined) return undefined;
	return new Response(head ? null : hit.body, hit);
}

/** Keeps `response` for later requests when its own headers allow it. The
 *  write goes to `waitUntil`, so the reader never waits on it. */
export function store(request: Request, response: Response): void {
	const cache = edge();
	if (cache === undefined || request.method !== 'GET' || !storable(response)) return;
	waitUntil(cache.put(request, response.clone()).catch(() => undefined));
}

function storable(response: Response): boolean {
	const control = response.headers.get('cache-control') ?? '';
	return (
		control !== '' &&
		STORABLE.has(response.status) &&
		!/private|no-cache|no-store/i.test(control) &&
		!(response.headers.get('vary') ?? '').includes('*') &&
		!response.headers.has('set-cookie')
	);
}
