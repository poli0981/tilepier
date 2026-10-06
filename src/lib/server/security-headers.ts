/**
 * The security headers every HTML response carries, doc 15 §2 — the one list.
 *
 * Two places send them, and only one of them can import this. `hooks.server.ts`
 * sets them on what the Worker renders, a 404 chiefly; the root `_headers` file
 * carries them for what the ASSETS binding serves, which is every prerendered
 * page, and those never reach the hook. `security-headers.test.ts` holds
 * `_headers` and doc 15 §2's block to this list, and the e2e suite holds both a
 * prerendered page and a Worker-rendered 404 to it, value for value.
 *
 * No Content-Security-Policy: SvelteKit emits that one (hooks.server.ts says
 * why), and `_headers` adds only its `frame-ancestors`, which a `<meta>` policy
 * cannot carry.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
	// What the zone sends in production, where its HSTS setting replaces this
	// header at the edge (doc 15 §2). Stated here so local and production agree.
	'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'strict-origin-when-cross-origin',
	'permissions-policy': 'geolocation=(self), microphone=(), camera=(), payment=()',
	'cross-origin-opener-policy': 'same-origin'
};
