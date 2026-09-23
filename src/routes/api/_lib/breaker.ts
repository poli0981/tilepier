import { BREAKER } from '$lib/shared-constants';

/**
 * Per-upstream circuit breaker (doc 11 §6).
 *
 * State lives in KV, which is eventually consistent across PoPs. That is
 * accepted deliberately: the goal is bulk back-off from a failing upstream,
 * not a precise distributed counter. A few PoPs probing independently costs
 * nothing; the alternative — a Durable Object — would be real infrastructure
 * for a $0 cache.
 */

/**
 * Every upstream that has a breaker, in the order `/api/_health` lists them.
 *
 * The functions below take this union rather than `string`, so an endpoint that
 * names a new upstream does not typecheck until the name is added here — which
 * is what stops the health report from quietly leaving one out. A list the
 * report kept for itself would be right on the day it was written.
 */
export const UPSTREAMS = [
	'open-meteo',
	'photon',
	'nominatim',
	'er-api',
	'binance-us',
	'finnhub',
	'twelvedata',
	// Not a data source: Turnstile's siteverify, whose outages the verify route
	// records here so the health report can say why passes went degraded.
	'turnstile'
] as const;
export type TpUpstream = (typeof UPSTREAMS)[number];

type BreakerState = 'closed' | 'open';

export interface BreakerRecord {
	state: BreakerState;
	openedAt: number;
	reason: string;
	/** Consecutive failures while closed. Reset by any success. */
	failures: number;
	/** Quota trips hold until UTC midnight rather than the short cool-down. */
	untilUtcMidnight?: boolean;
}

const key = (upstream: TpUpstream) => `kv:brk:${upstream}`;

export async function readBreaker(kv: KVNamespace, upstream: TpUpstream): Promise<BreakerRecord> {
	const raw = await kv.get(key(upstream), 'json');
	return (raw as BreakerRecord | null) ?? { state: 'closed', openedAt: 0, reason: '', failures: 0 };
}

/** Milliseconds until the next 00:00 UTC. */
export function msUntilUtcMidnight(now: number): number {
	const next = Date.UTC(
		new Date(now).getUTCFullYear(),
		new Date(now).getUTCMonth(),
		new Date(now).getUTCDate() + 1
	);
	return next - now;
}

/**
 * Whether upstream may be called.
 *
 * Returns `half-open` for the first request after the cool-down: that request
 * probes upstream, and its outcome closes the breaker or re-opens it.
 *
 * A quota trip's cool-down is the time from `openedAt` to the *next* UTC
 * midnight, measured once from the trip. It used to add `openedAt - now` on
 * top, which moved the target as the clock moved and released the breaker at
 * the midpoint instead — six hours early from a noon trip. Latent from Week 0
 * until `/api/stock/series` became the branch's first caller (doc 11 §6).
 */
export function breakerVerdict(
	record: BreakerRecord,
	now: number
): 'closed' | 'open' | 'half-open' {
	if (record.state === 'closed') return 'closed';

	const cooldown = record.untilUtcMidnight
		? msUntilUtcMidnight(record.openedAt)
		: BREAKER.cooldownMs;

	return now - record.openedAt >= cooldown ? 'half-open' : 'open';
}

export async function recordSuccess(kv: KVNamespace, upstream: TpUpstream): Promise<void> {
	await kv.put(
		key(upstream),
		JSON.stringify({ state: 'closed', openedAt: 0, reason: '', failures: 0 }),
		{ expirationTtl: 86_400 }
	);
}

/**
 * doc 11 §6: open on 3 consecutive 5xx/timeouts, or immediately on 429/418 or
 * a quota trip — those are upstream telling us to stop, not a flaky request.
 */
export async function recordFailure(
	kv: KVNamespace,
	upstream: TpUpstream,
	reason: string,
	options: { immediate?: boolean; untilUtcMidnight?: boolean; now?: number } = {}
): Promise<BreakerRecord> {
	const now = options.now ?? Date.now();
	const previous = await readBreaker(kv, upstream);
	const failures = previous.failures + 1;

	const shouldOpen = options.immediate || failures >= BREAKER.failureThreshold;
	const next: BreakerRecord = shouldOpen
		? {
				state: 'open',
				openedAt: now,
				reason,
				failures,
				...(options.untilUtcMidnight ? { untilUtcMidnight: true } : {})
			}
		: { state: 'closed', openedAt: 0, reason, failures };

	await kv.put(key(upstream), JSON.stringify(next), { expirationTtl: 86_400 });
	return next;
}
