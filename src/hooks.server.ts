import type { Handle, HandleServerError } from '@sveltejs/kit';
import { guardApi } from './routes/api/_lib/gate';

/**
 * Security headers for dynamically rendered responses, doc 15 §2.
 *
 * Two things are deliberately absent, both learned the hard way on 2026-08-10:
 *
 *  - **No Content-Security-Policy.** SvelteKit emits its own from
 *    `kit.csp` in svelte.config.js, including a hash for the inline script it
 *    uses to hand hydration data to the client. Setting a second CSP here
 *    would be enforced alongside it, and since this one could not know the
 *    hash, it would block hydration — the page would render perfectly and
 *    silently stop responding to clicks. `frame-ancestors` still needs a real
 *    header (it is ignored in a <meta> CSP) and lives in `_headers`.
 *
 *  - **This hook does not cover prerendered pages at all.** They are served
 *    from the ASSETS binding without ever reaching `handle`, so `_headers`
 *    carries the same set for them. Change both together.
 */
const SECURITY_HEADERS: Record<string, string> = {
	// What the zone sends in production, where its HSTS setting replaces this
	// header at the edge (doc 15 §2). Stated here so local and production agree.
	'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'geolocation=(self), microphone=(), camera=(), payment=()',
	'cross-origin-opener-policy': 'same-origin'
};

export const handle: Handle = async ({ event, resolve }) => {
	// The verification gate (doc 15 §3): every /api/* route, before it runs,
	// unless it is on the exemption list. Here rather than in each endpoint so a
	// route nobody remembered to guard is guarded anyway.
	if (event.url.pathname.startsWith('/api/')) {
		const refusal = await guardApi(event.request, event.route.id, event.platform?.env);
		if (refusal !== null) return refusal;
	}

	const response = await resolve(event);

	// HTML only. Hashed immutable assets do not need these, and /api/* returns
	// JSON whose envelope carries its own cache headers (doc 11 §2).
	const contentType = response.headers.get('content-type') ?? '';
	if (contentType.includes('text/html')) {
		for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
			response.headers.set(name, value);
		}
	}

	return response;
};

/**
 * Normalise errors to `{ id, message }` (doc 17 §1). The id is shown on the
 * 500 page so a bug report can be correlated with the log line, while the
 * message stays generic — upstream detail never reaches the client.
 */
export const handleError: HandleServerError = ({ error, status, message }) => {
	const id = crypto.randomUUID();

	// Server-side detail goes to `wrangler tail`, never to the response.
	if (status !== 404) {
		console.error(`[${id}]`, error);
	}

	return { id, message: status === 404 ? message : 'unexpected error' };
};
