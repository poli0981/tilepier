import type { TpHealthBreaker, TpHealthReport } from '$lib/api-types';
import { STOCK_BUDGET } from '$lib/shared-constants';
import { breakerVerdict, readBreaker, UPSTREAMS } from './breaker';
import { readSpend, utcDateKey } from './budget';

/**
 * The body of `GET /api/_health` (doc 11 §9). Kept out of the route file
 * because SvelteKit refuses any export from `+server.ts` that is not a method
 * handler — and only at build time, which is the worst time to find out.
 */

/** Longest `reason` the report prints. */
const REASON_MAX = 200;

/**
 * A breaker's `reason` is an upstream's error message, and one day that message
 * will contain something it should not: a URL with a credential in it, an
 * upstream echoing the key it was sent. Keys travel in headers precisely so
 * this never happens, but the report is the one place a reason leaves the
 * Worker, so it is masked here regardless — `name=value` pairs whose name
 * sounds secret, and any bare run of 32 or more key-alphabet characters.
 */
export function sanitizeReason(reason: string): string {
	const masked = reason
		.replace(/\b(api[-_]?key|key|token|secret|signature|sig|password)=[^&\s"']+/gi, '$1=…')
		.replace(/[A-Za-z0-9_-]{32,}/g, '…');
	return masked.length > REASON_MAX ? `${masked.slice(0, REASON_MAX - 1)}…` : masked;
}

export async function healthReport(
	kv: KVNamespace,
	env: Partial<Pick<Env, 'FINNHUB_KEY' | 'TWELVEDATA_KEY'>>,
	colo: string | null,
	now = Date.now()
): Promise<TpHealthReport> {
	const breakers = await Promise.all(
		UPSTREAMS.map(async (upstream): Promise<TpHealthBreaker> => {
			const record = await readBreaker(kv, upstream);
			return {
				upstream,
				state: record.state,
				verdict: breakerVerdict(record, now),
				openedAt: record.openedAt,
				failures: record.failures,
				reason: sanitizeReason(record.reason),
				untilUtcMidnight: record.untilUtcMidnight === true
			};
		})
	);

	return {
		now,
		colo,
		build: __TP_BUILD__,
		breakers,
		budget: {
			date: utcDateKey(now),
			spent: await readSpend(kv, now),
			dailyCredits: STOCK_BUDGET.dailyCredits,
			intradayStopAt: STOCK_BUDGET.intradayStopAt,
			dailySeriesStopAt: STOCK_BUDGET.dailySeriesStopAt
		},
		keys: {
			finnhub: (env.FINNHUB_KEY ?? '') !== '',
			twelvedata: (env.TWELVEDATA_KEY ?? '') !== ''
		}
	};
}
