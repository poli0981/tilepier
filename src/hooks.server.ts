import type { Handle, HandleServerError } from '@sveltejs/kit/hooks';
import { env } from 'cloudflare:workers';
import { SECURITY_HEADERS } from '#lib/server/security-headers.js';
import { hasDevToken } from './routes/api/_lib/dev-token';
import { lookup, store } from './routes/api/_lib/edge-cache';
import { guardApi } from './routes/api/_lib/gate';
import { checkRateLimit, clientKey } from './routes/api/_lib/ratelimit';
import { fail } from './routes/api/_lib/respond';

/*
 * Security headers for dynamically rendered responses, doc 15 §2.
 *
 * Two things are deliberately absent, both learned the hard way on 2026-08-10:
 *
 *  - **No Content-Security-Policy.** SvelteKit emits its own from the `csp`
 *    option in vite.config.ts (`#lib/server/csp.ts`), including a hash for the
 *    inline script it uses to hand hydration data to the client. Setting a
 *    second CSP here would be enforced alongside it, and since this one could
 *    not know the hash, it would block hydration — the page would render
 *    perfectly and silently stop responding to clicks. `frame-ancestors` still
 *    needs a real header (it is ignored in a <meta> CSP) and lives in
 *    `_headers`.
 *
 *  - **This hook does not cover prerendered pages at all.** They are served
 *    from the ASSETS binding without ever reaching `handle`, so `_headers`
 *    carries the same list for them; `#lib/server/security-headers.js` is that
 *    list, and its test holds `_headers` to it.
 */

type HandleInput = Parameters<Handle>[0];

export const handle: Handle = async ({ event, resolve }) => {
	const isApi = event.url.pathname.startsWith('/api/');
	const response =
		(await limit(event.request, isApi)) ??
		(isApi ? await api({ event, resolve }) : await resolve(event));

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
 * The Worker's rate limiter (doc 11 §7, `_lib/ratelimit.ts`), before anything
 * else the Worker does — an edge-cache hit and a gate refusal included, since
 * a flood of either still costs an invocation. `/api/*` and the pages the
 * Worker renders (a 404, a spike page) count on separate bindings, so a burst
 * of one never spends the other's allowance. Prerendered pages and static files
 * are served by the ASSETS binding without reaching this code at all; the zone
 * rule in front covers those.
 *
 * `null` lets the request through. Only a refused request pays for the
 * operator's bearer check, which lets the S3 harness (doc 22) through as the
 * gate does.
 */
async function limit(request: Request, isApi: boolean): Promise<Response | null> {
	// Before the bindings are read: a page being prerendered has no address,
	// and no env either.
	const key = clientKey(request);
	if (key === null) return null;

	const verdict = await checkRateLimit(isApi ? env.API_LIMITER : env.PAGE_LIMITER, key);
	if (verdict.allowed || (await hasDevToken(request, env.DEV_DASH_TOKEN))) return null;

	if (isApi) {
		const refusal = fail('RATE_LIMITED', verdict.retryAfterS);
		refusal.headers.set('cache-control', 'no-store');
		return refusal;
	}
	// No body: a sentence here would sit outside the message catalogue
	// (CLAUDE.md rule 8), and no reader comes near this many rendered pages.
	return new Response(null, {
		status: 429,
		headers: { 'retry-after': String(verdict.retryAfterS), 'cache-control': 'no-store' }
	});
}

/**
 * An `/api/*` request. The edge cache answers first, before the gate, as the
 * adapter's worker did before SvelteKit ran until adapter-cloudflare 8
 * (`_lib/edge-cache.ts`). Then the verification gate (doc 15 §3): every route,
 * before it runs, unless it is on the exemption list — here rather than in
 * each endpoint, so a route nobody remembered to guard is guarded anyway.
 */
async function api({ event, resolve }: HandleInput): Promise<Response> {
	const hit = await lookup(event.request);
	if (hit !== undefined) return hit;

	// The Worker's bindings, which adapter-cloudflare 8 no longer hands over as
	// `platform`. Read for /api only: a page being prerendered has none.
	const refusal = await guardApi(event.request, event.route.id, env);
	if (refusal !== null) return refusal;

	const response = await resolve(event);
	store(event.request, response);
	return response;
}

/**
 * Normalise errors to `{ id, message }` (doc 17 §1). The id is shown on the
 * 500 page so a bug report can be correlated with the log line, while the
 * message stays generic — upstream detail never reaches the client.
 *
 * Since SvelteKit 3 every error arrives here, told apart by `kind`, and an
 * answer without a `message` keeps the error's own. An error thrown on purpose
 * (`app`, `validation`) carries a message meant for the reader, and one
 * SvelteKit raises below 500 — no such route, no such method — is the
 * request's doing: those keep their message, unlogged. Everything else is a
 * fault.
 */
export const handleError: HandleServerError = (caught) => {
	const id = crypto.randomUUID();
	if (caught.kind === 'app' || caught.kind === 'validation') return { id };
	if (caught.kind === 'framework' && caught.error.status < 500) return { id };

	// Server-side detail goes to `wrangler tail`, never to the response.
	console.error(`[${id}]`, caught.error);
	return { id, message: 'unexpected error' };
};
