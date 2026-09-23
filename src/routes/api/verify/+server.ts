import type { RequestHandler } from './$types';
import type { TpApiMeta, TpVerifyConfig, TpVerifyPass } from '$lib/api-types';
import { readBreaker, recordFailure, recordSuccess } from '../_lib/breaker';
import { gateState } from '../_lib/gate';
import { issuePass } from '../_lib/pass';
import { checkRateLimit } from '../_lib/ratelimit';
import { fail, isCrossSite, okNoStore } from '../_lib/respond';
import { MAX_TOKEN_LENGTH, siteverify } from '../_lib/turnstile';

/**
 * `/api/verify` — where a browser trades a Turnstile token for a pass
 * (doc 15 §3). Exempt from the gate it serves, by definition.
 *
 * `GET` says whether there is a gate at all: the sitekey to render, or `null`.
 * `no-store`, because the adapter's edge cache would otherwise keep answering
 * "no gate" for minutes after the secret was put.
 *
 * `POST {token}` asks siteverify and answers with a pass. Three outcomes:
 * a real token gets an hour; a refused one gets `VERIFY_REQUIRED`; and a token
 * that could not be checked because siteverify itself was unreachable gets a
 * ten-minute degraded pass, recorded against the `turnstile` breaker so
 * `/api/_health` can say why. That last is the same fail-open choice the rate
 * limiter makes: an outage at Cloudflare's end should cost a re-check, not the
 * app — and nobody outside Cloudflare can cause one.
 */

/** A token is ≤ 2048 characters; the envelope around it is a few more. */
const MAX_BODY_BYTES = 4096;

function meta(now: number): TpApiMeta {
	return { cachedAt: Math.floor(now / 1000), source: 'turnstile', stale: false };
}

export const GET: RequestHandler = ({ platform }) => {
	const env = platform?.env;
	const sitekey = gateState(env) === 'on' ? (env?.TURNSTILE_SITE_KEY ?? null) : null;
	return okNoStore<TpVerifyConfig>({ sitekey }, meta(Date.now()));
};

export const POST: RequestHandler = async ({ request, url, platform }) => {
	// SvelteKit's CSRF check covers form posts only; this one is JSON, so the
	// origin is checked here. A browser always sends it on a cross-origin-capable
	// POST, and anything else has no business trading tokens.
	if (isCrossSite(request) || request.headers.get('origin') !== url.origin) {
		return new Response(null, { status: 403 });
	}

	const env = platform?.env;
	const secret = env?.TURNSTILE_SECRET_KEY ?? '';
	// No gate, nothing to trade for — and a `misconfigured` gate is not enforced.
	if (gateState(env) !== 'on') return fail('BAD_REQUEST');

	const kv = env?.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const token = await readToken(request);
	if (token === null) return fail('BAD_REQUEST');

	const now = Date.now();
	const answer = await siteverify({
		secret,
		token,
		hostname: url.hostname,
		remoteip: request.headers.get('cf-connecting-ip')
	});

	if (answer.verdict === 'fail') return fail('VERIFY_REQUIRED');

	if (answer.verdict === 'unavailable') {
		await recordFailure(kv, 'turnstile', answer.reason).catch(() => undefined);
	} else {
		// Only write when there is a failure to clear: a KV write per page load
		// would be the price of a breaker nobody reads.
		const breaker = await readBreaker(kv, 'turnstile').catch(() => null);
		if (breaker !== null && breaker.failures > 0) {
			await recordSuccess(kv, 'turnstile').catch(() => undefined);
		}
	}

	const issued = await issuePass(secret, now, answer.verdict === 'unavailable');
	return okNoStore<TpVerifyPass>(issued, meta(now));
};

/** The token from a small JSON body, or `null` for anything else. */
async function readToken(request: Request): Promise<string | null> {
	const text = await request.text().catch(() => '');
	if (text.length === 0 || text.length > MAX_BODY_BYTES) return null;
	try {
		const body: unknown = JSON.parse(text);
		const token = (body as { token?: unknown } | null)?.token;
		return typeof token === 'string' && token.length > 0 && token.length <= MAX_TOKEN_LENGTH
			? token
			: null;
	} catch {
		return null;
	}
}
