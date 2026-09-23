import { PASS_HEADER } from '$lib/shared-constants';
import { hasDevToken } from './dev-token';
import { verifyPass } from './pass';
import { fail } from './respond';

/**
 * The verification gate in front of `/api/*` (doc 15 §3).
 *
 * **Deny by default, in one place.** It runs from `hooks.server.ts` before any
 * endpoint, so a route added next week is guarded without anyone remembering
 * to guard it; the only way out is the exemption list below, keyed by route id
 * rather than by path so no spelling of a URL can slip past it.
 *
 * **What it protects is upstream spend, not the data.** The adapter's worker
 * replays any cacheable GET from `caches.default` before hooks run, so a URL
 * already in the edge cache answers without a pass for up to half its TTL.
 * That is public data costing nothing; what a pass stands in front of is the
 * cache MISS — the request that reaches Twelve Data, Open-Meteo, Binance — which
 * is the quota-drain threat doc 15 §1(c) names.
 */

type GateEnv = Partial<Pick<Env, 'TURNSTILE_SECRET_KEY' | 'TURNSTILE_SITE_KEY' | 'DEV_DASH_TOKEN'>>;

export type TpGateState = 'on' | 'off' | 'misconfigured';

/**
 * The routes the gate never guards: the one that issues passes, and the
 * operator's. Route ids, not paths.
 */
export const GATE_EXEMPT: ReadonlySet<string> = new Set(['/api/verify', '/api/_health']);

/**
 * `on` needs both halves. No secret is `off` — a developer's machine, CI, and
 * any deploy before the secret was put. A secret without a sitekey is
 * `misconfigured`: no browser could render the check, so enforcing would take
 * every networked tile down; it is reported by `/api/_health` and not enforced.
 */
export function gateState(env: GateEnv | undefined): TpGateState {
	if ((env?.TURNSTILE_SECRET_KEY ?? '') === '') return 'off';
	return (env?.TURNSTILE_SITE_KEY ?? '') === '' ? 'misconfigured' : 'on';
}

/**
 * `null` lets the request through; a `Response` is the refusal to send instead.
 */
export async function guardApi(
	request: Request,
	routeId: string | null,
	env: GateEnv | undefined,
	now = Date.now()
): Promise<Response | null> {
	if (routeId !== null && GATE_EXEMPT.has(routeId)) return null;

	const secret = env?.TURNSTILE_SECRET_KEY ?? '';
	if (gateState(env) !== 'on') return null;

	// The operator's curl and the S3 load harness (doc 22) carry the bearer
	// instead of solving a challenge.
	if (await hasDevToken(request, env?.DEV_DASH_TOKEN)) return null;

	const pass = request.headers.get(PASS_HEADER);
	if (pass !== null && (await verifyPass(secret, pass, now))) return null;

	const refusal = fail('VERIFY_REQUIRED');
	refusal.headers.set('cache-control', 'no-store');
	return refusal;
}
