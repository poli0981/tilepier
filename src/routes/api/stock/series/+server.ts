import type { RequestHandler } from './$types';
import type { TpStockQuote, TpStockSeriesPayload } from '$lib/api-types';
import {
	cacheKey,
	stockSeriesFamily,
	STOCK_BUDGET,
	type TpCacheFamily
} from '$lib/shared-constants';
import { breakerVerdict, readBreaker, recordFailure, recordSuccess } from '../../_lib/breaker';
import {
	markMinuteSpent,
	mayFetch,
	minuteSpent,
	parseCreditsLeft,
	readSpend,
	recordSpend,
	secondsToNextMinute
} from '../../_lib/budget';
import { FINNHUB, finnhubHeaders, finnhubQuoteUrl } from '../../_lib/finnhub';
import { readCache, ttlSeconds, writeCache, type CachedValue } from '../../_lib/kv-cache';
import { normalizeStockQuote, normalizeStockSeries } from '../../_lib/normalize';
import { checkRateLimit } from '../../_lib/ratelimit';
import { fail, isCrossSite, ok } from '../../_lib/respond';
import { parseStockSeriesQuery } from '../../_lib/stock-query';
import {
	creditWindow,
	TWELVEDATA,
	timeSeriesUrl,
	twelveDataError,
	twelveDataHeaders
} from '../../_lib/twelvedata';
import { fetchUpstream, UpstreamError } from '../../_lib/upstream';

/**
 * `GET /api/stock/series?symbol=AAPL&interval=1day&limit=22` — doc 11 §3,
 * upstream doc 10 §5. The one route that spends a budgeted quota: Twelve Data's
 * 800 credits a day.
 *
 * In the order a request meets them:
 *
 * 1. **The cache holds one deep series per symbol and interval**, and the
 *    response is a window onto it — the klines rule (doc 11 §3).
 * 2. **Only a symbol Finnhub quotes may spend a credit.** One pass through the
 *    Turnstile gate is thirty requests a ten-second bucket (doc 11 §7), which
 *    is the whole day's budget in half a minute of random symbols. So a MISS
 *    first reads `st:q:v1:<sym>` — asking Finnhub, whose 60 a minute are not
 *    budgeted, when nothing is cached. An unknown symbol gets an empty series,
 *    cached, which the detail draws as its quote-only view (doc 09 §1).
 * 3. **The budget guard** (doc 11 §5): intraday stops at 720, daily at 780.
 *    Daily reaching its stop trips the breaker until UTC midnight, which is
 *    what makes the stop stick across PoPs. Stale is served either way; with
 *    nothing stale the answer is `QUOTA_EXHAUSTED`.
 * 4. **The minute.** Basic allows eight credits a minute as well as 800 a day.
 *    A minute already known to be spent answers `RATE_LIMITED` until it turns
 *    (stale first, when there is some) without spending a call on the refusal.
 * 5. **Twelve Data's own words.** Its errors can arrive inside a 200. A 429 is
 *    the day only when it says so — a quota trip until midnight — and the
 *    minute otherwise, which marks the minute and trips nothing. A symbol it
 *    does not cover is a negative cache, never a breaker failure, so three
 *    mistyped symbols cannot open the breaker for everyone. Anything else is a
 *    failure like any upstream's.
 * 6. **The spend is recorded after the call.** `api-credits-left` counts the
 *    minute, not the day — reading it as the day stopped every series after
 *    the first call on 2026-09-23 — so it only ever marks the minute.
 *
 * There is no fallback source. Stooq was dropped on 2026-09-23 (doc 10 §5),
 * and the daily stale window — seven days — is what covers an outage.
 */

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const query = parseStockSeriesQuery(url);
	if (!query) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const family = stockSeriesFamily(query.interval);
	const key = cacheKey.stockSeries(query.symbol, query.interval);
	const cached = await readCache<TpStockSeriesPayload>(kv, family, key);
	if (cached.status === 'HIT' && cached.value) {
		return serve(cached.value, 'HIT', false, family, query.limit);
	}

	const stale = (
		code: 'UPSTREAM_DOWN' | 'QUOTA_EXHAUSTED' | 'RATE_LIMITED',
		retryAfterS?: number
	) =>
		cached.value
			? serve(cached.value, 'STALE', true, family, query.limit)
			: fail(code, retryAfterS);

	const env = platform?.env;
	const tdKey = env?.TWELVEDATA_KEY ?? '';
	if (tdKey === '') return stale('UPSTREAM_DOWN');

	const now = Date.now();
	const breaker = await readBreaker(kv, TWELVEDATA);
	if (breakerVerdict(breaker, now) === 'open') {
		return stale(breaker.untilUtcMidnight ? 'QUOTA_EXHAUSTED' : 'UPSTREAM_DOWN');
	}

	const persist = (work: Promise<unknown>) => {
		const settled = work.catch(() => undefined);
		if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(settled);
		return settled;
	};

	const known = await knownSymbol(kv, query.symbol, env?.FINNHUB_KEY ?? '', now, persist);
	if (known === 'unverifiable') return stale('UPSTREAM_DOWN');
	if (known === 'unknown') {
		const empty = normalizeStockSeries({ values: [] }, query.symbol, query.interval);
		void persist(writeCache(kv, family, key, empty, TWELVEDATA, now));
		return answer(empty, now, 'MISS', family, query.limit);
	}

	const kind = query.interval === '15min' ? 'intraday' : 'daily';
	const spent = await readSpend(kv, now);
	if (!mayFetch(kind, spent)) {
		if (kind === 'daily') {
			void persist(
				recordFailure(
					kv,
					TWELVEDATA,
					`budget: ${String(spent)} of ${String(STOCK_BUDGET.dailyCredits)}`,
					{
						immediate: true,
						untilUtcMidnight: true,
						now
					}
				)
			);
		}
		return stale('QUOTA_EXHAUSTED');
	}

	if (await minuteSpent(kv, now)) return stale('RATE_LIMITED', secondsToNextMinute(now));

	try {
		const result = await fetchUpstream<unknown>(timeSeriesUrl(query.symbol, query.interval), {
			headers: twelveDataHeaders(tdKey)
		});
		const creditsLeft = parseCreditsLeft(result.headers);
		void persist(recordSpend(kv, 1, now));
		if (creditsLeft === 0) void persist(markMinuteSpent(kv, now));

		const reported = twelveDataError(result.data);
		if (reported !== null) {
			if (reported.code === 429) return refused(reported.message);
			if (reported.code >= 400 && reported.code < 500) return notCovered();
			throw new UpstreamError(`twelvedata ${String(reported.code)}: ${reported.message}`, 'status');
		}

		const payload = normalizeStockSeries(result.data, query.symbol, query.interval);
		void persist(
			Promise.all([
				writeCache(kv, family, key, payload, TWELVEDATA, now),
				recordSuccess(kv, TWELVEDATA)
			])
		);
		return answer(payload, now, 'MISS', family, query.limit);
	} catch (error) {
		const upstream = error instanceof UpstreamError ? error : null;
		if (upstream?.status === 429) return refused(upstream.message);
		if (upstream?.status === 400 || upstream?.status === 404) return notCovered();
		await recordFailure(kv, TWELVEDATA, upstream?.message ?? String(error), { now }).catch(
			() => undefined
		);
		return stale('UPSTREAM_DOWN');
	}

	/**
	 * A 429, sized by its own words (`creditWindow`). The day holds the breaker
	 * until UTC midnight; the minute marks the minute, which the next request
	 * reads before spending a call, and leaves the breaker alone — running into
	 * a per-minute limit says nothing about whether Twelve Data is healthy.
	 */
	async function refused(reason: string): Promise<Response> {
		if (creditWindow(reason) === 'day') {
			await recordFailure(kv!, TWELVEDATA, reason, {
				immediate: true,
				untilUtcMidnight: true,
				now
			}).catch(() => undefined);
			return stale('QUOTA_EXHAUSTED');
		}
		await markMinuteSpent(kv!, now).catch(() => undefined);
		return stale('RATE_LIMITED', secondsToNextMinute(now));
	}

	/** A symbol Twelve Data does not cover: an empty series, cached, and no
	 *  breaker failure — it is a fact about the symbol, not about upstream. */
	function notCovered(): Response {
		const empty = normalizeStockSeries({ values: [] }, query!.symbol, query!.interval);
		void persist(writeCache(kv!, family, key, empty, TWELVEDATA, now));
		return answer(empty, now, 'MISS', family, query!.limit);
	}
};

/**
 * Whether Finnhub quotes `symbol`, from the quote cache when it can be and from
 * one Finnhub call when it cannot. `unverifiable` when neither is possible —
 * and then no credit is spent, because "could not check" must not mean "spend".
 */
async function knownSymbol(
	kv: KVNamespace,
	symbol: string,
	finnhubKey: string,
	now: number,
	persist: (work: Promise<unknown>) => Promise<unknown>
): Promise<'known' | 'unknown' | 'unverifiable'> {
	const cached = await readCache<TpStockQuote | null>(
		kv,
		'stQuote',
		cacheKey.stockQuote(symbol),
		now
	);
	if (cached.value) return cached.value.payload === null ? 'unknown' : 'known';

	if (finnhubKey === '') return 'unverifiable';
	if (breakerVerdict(await readBreaker(kv, FINNHUB), now) === 'open') return 'unverifiable';

	try {
		const result = await fetchUpstream<unknown>(finnhubQuoteUrl(symbol), {
			headers: finnhubHeaders(finnhubKey)
		});
		const quote = normalizeStockQuote(result.data, symbol, now);
		void persist(writeCache(kv, 'stQuote', cacheKey.stockQuote(symbol), quote, FINNHUB, now));
		return quote === null ? 'unknown' : 'known';
	} catch {
		return 'unverifiable';
	}
}

/** The last `limit` bars — the newest, which is what a range means. */
function window(payload: TpStockSeriesPayload, limit: number): TpStockSeriesPayload {
	if (payload.candles.length <= limit) return payload;
	return { ...payload, candles: payload.candles.slice(-limit) };
}

function answer(
	payload: TpStockSeriesPayload,
	now: number,
	status: 'MISS',
	family: TpCacheFamily,
	limit: number
): Response {
	return ok(
		window(payload, limit),
		{ cachedAt: Math.floor(now / 1000), source: TWELVEDATA, stale: false },
		status,
		ttlSeconds(family)
	);
}

function serve(
	value: CachedValue<TpStockSeriesPayload>,
	status: 'HIT' | 'STALE',
	stale: boolean,
	family: TpCacheFamily,
	limit: number
): Response {
	return ok(
		window(value.payload, limit),
		{ cachedAt: Math.floor(value.cachedAt / 1000), source: value.source, stale },
		status,
		ttlSeconds(family)
	);
}
