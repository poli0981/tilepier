import { STOCK_BUDGET } from '$lib/shared-constants';

/**
 * Twelve Data daily credit guard (doc 11 §5).
 *
 * Two signals, and the lower one wins: a KV counter we increment ourselves,
 * and the `api-credits-left` header upstream sends back. Trusting only our own
 * counter drifts (KV is eventually consistent, and other clients on the same
 * key would not be counted); trusting only the header means the first request
 * of the day has no idea where it stands.
 */

export type SeriesKind = 'intraday' | 'daily';

const counterKey = (utcDate: string) => `kv:st:budget:${utcDate}`;

export function utcDateKey(now = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10);
}

export async function readSpend(kv: KVNamespace, now = Date.now()): Promise<number> {
	const raw = await kv.get(counterKey(utcDateKey(now)));
	return raw ? Number(raw) : 0;
}

/**
 * Best-effort increment. KV has no atomic counter, and a Durable Object is
 * more infrastructure than a $0 quota guard deserves — under-counting by a few
 * under concurrency is fine because the tiers below leave 20 credits of slack
 * before the real ceiling.
 */
export async function recordSpend(
	kv: KVNamespace,
	credits: number,
	now = Date.now()
): Promise<number> {
	const spent = (await readSpend(kv, now)) + credits;
	await kv.put(counterKey(utcDateKey(now)), String(spent), {
		// Expire a little after UTC midnight so the next day starts clean.
		expirationTtl: 90_000
	});
	return spent;
}

/**
 * doc 11 §5: at ≥ 720 stop intraday MISS fetches (serve stale or Stooq); daily
 * series keep going to 780; past that nothing goes upstream until UTC reset.
 */
export function mayFetch(kind: SeriesKind, spent: number, creditsLeft?: number): boolean {
	// `api-credits-left` is upstream's own truth; fold it in by treating it as
	// an alternative spend figure and taking the pessimistic view.
	const effective =
		creditsLeft == null ? spent : Math.max(spent, STOCK_BUDGET.dailyCredits - creditsLeft);

	return kind === 'intraday'
		? effective < STOCK_BUDGET.intradayStopAt
		: effective < STOCK_BUDGET.dailySeriesStopAt;
}

/** Parses Twelve Data's `api-credits-left` header; undefined when absent. */
export function parseCreditsLeft(headers: Headers): number | undefined {
	const raw = headers.get('api-credits-left');
	if (raw == null) return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}
