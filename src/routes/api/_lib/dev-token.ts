/**
 * The operator's bearer token, `DEV_DASH_TOKEN` (doc 11 §9, doc 15 §6).
 *
 * It opens `GET /api/_health`, and nothing else yet. Two rules make it safe to
 * leave on a public origin:
 *
 *  - **An unset or short token is no token.** `.dev.vars.example` ships the
 *    name with an empty value, and a comparison that let `Bearer ` match an
 *    empty secret would hand the endpoint to anyone who sent the header bare.
 *    Below {@link DEV_TOKEN_MIN_LENGTH} characters the feature is simply off.
 *  - **The comparison is constant-time.** Both sides are MACed under a key
 *    made for this call and the tags compared with `crypto.subtle.verify`, so
 *    the time taken says nothing about how much of a guess was right. It works
 *    the same in workerd and in Node, which `timingSafeEqual` — a Workers-only
 *    extension — would not.
 *
 * The token travels in `Authorization`, never in a query string: a URL lands in
 * the Worker's invocation logs and in browser history, where a header does not.
 */

export const DEV_TOKEN_MIN_LENGTH = 32;

const BEARER = /^Bearer (\S+)$/;

export async function hasDevToken(
	request: Request,
	expected: string | undefined
): Promise<boolean> {
	if (expected === undefined || expected.length < DEV_TOKEN_MIN_LENGTH) return false;

	const offered = BEARER.exec(request.headers.get('authorization') ?? '')?.[1];
	if (offered === undefined) return false;

	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		crypto.getRandomValues(new Uint8Array(32)),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign', 'verify']
	);
	const tag = await crypto.subtle.sign('HMAC', key, encoder.encode(expected));
	return crypto.subtle.verify('HMAC', key, tag, encoder.encode(offered));
}
