import { cacheKey } from '$lib/shared-constants';
import type { TpFxHistoryPoint, TpFxSnapshotPayload } from '$lib/api-types';
import { utcDateKey } from './budget';
import { readCache } from './kv-cache';

/**
 * Reading the permanent `fx:snap:` pile back out as a series (doc 10 §3).
 *
 * **Explicit gets over a computed date range, never `kv.list`.** `list` returns
 * keys and metadata but not values, so it would be followed by the same N gets
 * anyway and buy only a pagination loop; it pages at 1000; and we already know
 * every key we want, because "the last N days" is a calendar computation rather
 * than a question KV has to answer. A date with no key is a day upstream
 * published nothing, which is legal and is why the chart plots against a time
 * axis instead of an index.
 *
 * Split from the endpoint so the arithmetic is testable without a request, in
 * the same spirit as `normalize.ts` (doc 19 §3.5).
 */

/**
 * How many `fx:snap:` keys to ask for at once.
 *
 * Defensive rather than measured: KV reads are not fetch subrequests, so the
 * 1000-subrequest ceiling does not apply, and no documented cap on concurrent
 * KV operations per request could be found. At the largest allowed range this
 * is eight batches instead of one 365-wide fan-out, which costs a few
 * milliseconds and removes a whole class of thing to be surprised by.
 */
export const SNAPSHOT_BATCH = 50;

/**
 * The `days` calendar dates ending today, ascending.
 *
 * Inclusive of today, so `days: 7` is this day and the six before it — the
 * window a reader means by "the last week", not "the week before this one".
 */
export function snapshotDates(days: number, now: number): string[] {
	const dates: string[] = [];
	const DAY_MS = 24 * 60 * 60 * 1000;

	for (let back = days - 1; back >= 0; back--) {
		dates.push(utcDateKey(now - back * DAY_MS));
	}
	return dates;
}

/** One rate table per date, `null` where that day has no snapshot. */
export type SnapshotWindow = readonly (Record<string, number> | null)[];

/**
 * Reads a window of snapshots, in order, in batches.
 *
 * The returned array lines up with `dates` index for index, because the caller
 * needs to know *which* day each table belongs to and a filtered list would
 * have thrown that away.
 */
export async function readSnapshots(kv: KVNamespace, dates: string[]): Promise<SnapshotWindow> {
	const tables: (Record<string, number> | null)[] = [];

	for (let i = 0; i < dates.length; i += SNAPSHOT_BATCH) {
		const batch = dates.slice(i, i + SNAPSHOT_BATCH);
		const read = await Promise.all(
			batch.map((date) => readCache<TpFxSnapshotPayload>(kv, 'fxSnap', cacheKey.fxSnapshot(date)))
		);
		// `Promise.all` preserves order within a batch and the batches are
		// appended in order, so the result stays aligned with `dates`.
		for (const entry of read) tables.push(entry.value === null ? null : entry.value.payload.rates);
	}

	return tables;
}

/**
 * Cross-rates a window into a series, dropping the days it cannot answer for.
 *
 * A day contributes nothing when it has no snapshot, when either side of the
 * pair is missing from that day's table, or when the base is not a number we
 * can divide by. Dropping is the honest move: interpolating would invent a rate
 * that never existed, and a zero would be a rate of zero rather than a gap.
 */
export function assembleHistory(
	base: string,
	quote: string,
	dates: readonly string[],
	tables: SnapshotWindow
): TpFxHistoryPoint[] {
	const points: TpFxHistoryPoint[] = [];

	for (const [index, date] of dates.entries()) {
		const table = tables[index];
		if (table === null || table === undefined) continue;

		const from = table[base];
		const to = table[quote];
		if (typeof from !== 'number' || !Number.isFinite(from) || from <= 0) continue;
		if (typeof to !== 'number' || !Number.isFinite(to)) continue;

		points.push({ date, rate: to / from });
	}

	return points;
}
