import type { TpStockInterval } from '$lib/api-types';

/**
 * Twelve Data (doc 10 §5): stock series, the one budgeted upstream — 800
 * credits a day, one per call, 8 a minute (doc 11 §5).
 *
 * The key goes in `Authorization: apikey …`, never in the URL, for the reason
 * `finnhub.ts` gives: the URL is what a failure message would carry into
 * `/api/_health`.
 */

const HOST = 'https://api.twelvedata.com';

/** The breaker key, and the `source` every series response carries. */
export const TWELVEDATA = 'twelvedata';

export const TWELVEDATA_ATTRIBUTION = 'Stock charts by Twelve Data';

/**
 * How deep a series is fetched, per interval. The cache holds one deep series
 * and each range is a window onto it — the klines rule (doc 11 §3), for the
 * same reason: the key carries no depth, so two ranges would otherwise
 * overwrite each other. 130 fifteen-minute bars is five sessions against 1D's
 * one; 260 days is a year of sessions with room for holidays against 1Y's 252.
 */
const SERIES_DEPTH: Record<TpStockInterval, number> = { '15min': 130, '1day': 260 };

export function twelveDataHeaders(key: string): Record<string, string> {
	return { authorization: `apikey ${key}` };
}

/**
 * `timezone=UTC`, so a bar's datetime parses without an exchange calendar;
 * `order=asc`, the order the chart plots in.
 */
export function timeSeriesUrl(symbol: string, interval: TpStockInterval): string {
	const params = new URLSearchParams({
		symbol,
		interval,
		outputsize: String(SERIES_DEPTH[interval]),
		timezone: 'UTC',
		order: 'asc',
		format: 'JSON'
	});
	return `${HOST}/time_series?${params.toString()}`;
}

export interface TpTwelveDataError {
	code: number;
	message: string;
}

/**
 * Twelve Data reports some failures inside a 200 as `{ status: 'error', code,
 * message }` rather than as an HTTP status — a symbol it does not cover, a plan
 * limit, and on some routes the daily credits running out. Read both ways.
 */
export function twelveDataError(body: unknown): TpTwelveDataError | null {
	if (typeof body !== 'object' || body === null) return null;
	const record = body as { status?: unknown; code?: unknown; message?: unknown };
	if (record.status !== 'error') return null;
	return {
		code: typeof record.code === 'number' ? record.code : 0,
		message: typeof record.message === 'string' ? record.message : 'error'
	};
}
