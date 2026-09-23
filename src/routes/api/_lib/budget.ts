import { STOCK_BUDGET } from '$lib/shared-constants';

/**
 * Twelve Data's two limits (doc 11 §5, doc 10 §5): 800 credits a day on
 * Basic, and eight a minute.
 *
 * **The day is our own counter, and only our own counter.** Until 2026-09-23
 * this module also folded in the `api-credits-left` header as "credits left
 * today", taking the pessimistic view of the two. The header counts the
 * *minute*: after the first call of a day it says 7, which read as 793 spent,
 * and the guard stopped every series until UTC midnight. Production showed
 * `budget: 793 of 800` the day stocks shipped. There is no daily figure in any
 * header; Twelve Data's `/api_usage` has one and costs a credit to ask.
 *
 * **The minute is what the header is for.** When it reaches 0, the rest of
 * that minute is marked in KV so the next request answers "slow down" without
 * spending a call on a refusal — the same mark a per-minute 429 leaves.
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
 * doc 11 §5: at ≥ 720 stop intraday MISS fetches (serve stale, or refuse); daily
 * series keep going to 780; past that nothing goes upstream until UTC reset.
 * The 20-credit slack above 780 is what absorbs our counter under-counting
 * under concurrency — it is the only daily figure there is.
 */
export function mayFetch(kind: SeriesKind, spent: number): boolean {
	return kind === 'intraday'
		? spent < STOCK_BUDGET.intradayStopAt
		: spent < STOCK_BUDGET.dailySeriesStopAt;
}

/* ─────────────────────────────────────────────────────────────── the minute */

const minuteKey = (now: number) => `kv:st:minute:${String(Math.floor(now / 60_000))}`;

/** Seconds until the minute turns — what a "slow down" names as `retry-after`. */
export function secondsToNextMinute(now: number): number {
	return 60 - Math.floor((now % 60_000) / 1000);
}

/**
 * Whether this minute's credits are known to be spent. Best-effort, like the
 * rate limiter: KV is eventually consistent, so another PoP may not see the
 * mark in time and spend one refused call finding out for itself.
 */
export async function minuteSpent(kv: KVNamespace, now = Date.now()): Promise<boolean> {
	return (await kv.get(minuteKey(now))) !== null;
}

/** Marks the rest of this minute as spent. Sixty seconds is KV's shortest TTL,
 *  and the key names the minute, so a mark cannot outlive it by more. */
export async function markMinuteSpent(kv: KVNamespace, now = Date.now()): Promise<void> {
	await kv.put(minuteKey(now), '1', { expirationTtl: 60 });
}

/** Parses Twelve Data's `api-credits-left` header — credits left **this
 *  minute** — or undefined when absent. */
export function parseCreditsLeft(headers: Headers): number | undefined {
	const raw = headers.get('api-credits-left');
	if (raw == null) return undefined;
	const value = Number(raw);
	return Number.isFinite(value) ? value : undefined;
}
