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

const key = (upstream: string) => `kv:brk:${upstream}`;

export async function readBreaker(kv: KVNamespace, upstream: string): Promise<BreakerRecord> {
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
 */
export function breakerVerdict(
	record: BreakerRecord,
	now: number
): 'closed' | 'open' | 'half-open' {
	if (record.state === 'closed') return 'closed';

	const cooldown = record.untilUtcMidnight
		? msUntilUtcMidnight(record.openedAt) + (record.openedAt - now)
		: BREAKER.cooldownMs;

	return now - record.openedAt >= cooldown ? 'half-open' : 'open';
}

export async function recordSuccess(kv: KVNamespace, upstream: string): Promise<void> {
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
	upstream: string,
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
