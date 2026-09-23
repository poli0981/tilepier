import { TURNSTILE_ACTION } from '$lib/shared-constants';

/**
 * Cloudflare Turnstile's server half (doc 15 §3): one POST to siteverify per
 * token, answered with a verdict the verify route can act on.
 *
 * Three verdicts, not two, because "Cloudflare could not be asked" is not the
 * same as "Cloudflare said no":
 *
 * - `pass` — a real token for this sitekey, action and host.
 * - `fail` — a token Cloudflare looked at and refused: forged, reused
 *   (`timeout-or-duplicate`), expired, or minted for another action or host.
 *   Never softened into anything else.
 * - `unavailable` — siteverify timed out, errored, or said `internal-error`.
 *   The route issues a short degraded pass for this one, so an outage at
 *   Cloudflare's end does not take every networked tile down with it.
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Cloudflare's own ceiling for a token (doc 15 §3). */
export const MAX_TOKEN_LENGTH = 2048;

const TIMEOUT_MS = 5000;

export type TpSiteverify =
	| { verdict: 'pass' }
	| { verdict: 'fail'; codes: string[] }
	| { verdict: 'unavailable'; reason: string };

interface SiteverifyBody {
	success?: unknown;
	'error-codes'?: unknown;
	action?: unknown;
	hostname?: unknown;
	metadata?: { result_with_testing_key?: unknown };
}

export async function siteverify(options: {
	secret: string;
	token: string;
	/** The request's own hostname; the token must have been minted on it. */
	hostname: string;
	remoteip?: string | null;
	fetcher?: typeof fetch;
}): Promise<TpSiteverify> {
	const form = new FormData();
	form.set('secret', options.secret);
	form.set('response', options.token);
	form.set('idempotency_key', crypto.randomUUID());
	if (options.remoteip) form.set('remoteip', options.remoteip);

	let response: Response;
	try {
		response = await (options.fetcher ?? fetch)(SITEVERIFY, {
			method: 'POST',
			body: form,
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (error) {
		return { verdict: 'unavailable', reason: error instanceof Error ? error.name : 'network' };
	}

	if (response.status >= 500)
		return { verdict: 'unavailable', reason: `siteverify ${String(response.status)}` };

	let body: SiteverifyBody;
	try {
		body = (await response.json()) as SiteverifyBody;
	} catch {
		return { verdict: 'unavailable', reason: 'siteverify answered something other than JSON' };
	}

	const codes = Array.isArray(body['error-codes'])
		? body['error-codes'].filter((code): code is string => typeof code === 'string')
		: [];
	if (codes.includes('internal-error')) return { verdict: 'unavailable', reason: 'internal-error' };
	if (body.success !== true) return { verdict: 'fail', codes };

	// An answer for a testing secret carries no action and the host
	// `example.com`, so neither can be checked — which is safe only because a
	// testing secret never verifies a real token. Siteverify says so itself;
	// trusting that flag beats matching the secret's shape, which the first
	// version of this file got wrong (the testing secrets are 35 characters,
	// `1x` + 31 zeros + `AA`, and it expected 23 — measured on 2026-09-23 by
	// an end-to-end run against `pnpm preview`, which the stubbed tests could
	// not have caught).
	if (body.metadata?.result_with_testing_key === true) return { verdict: 'pass' };
	if (body.action !== TURNSTILE_ACTION) return { verdict: 'fail', codes: ['action-mismatch'] };
	if (body.hostname !== options.hostname) return { verdict: 'fail', codes: ['hostname-mismatch'] };
	return { verdict: 'pass' };
}
