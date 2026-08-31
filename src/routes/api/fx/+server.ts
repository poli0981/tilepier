import type { RequestHandler } from './$types';
import { cacheKey } from '$lib/shared-constants';
import { readCache, ttlSeconds, writeCache, type CachedValue } from '../_lib/kv-cache';
import { breakerVerdict, readBreaker, recordFailure, recordSuccess } from '../_lib/breaker';
import { checkRateLimit } from '../_lib/ratelimit';
import { utcDateKey } from '../_lib/budget';
import { fetchUpstream, UpstreamError } from '../_lib/upstream';
import { fail, isCrossSite, ok } from '../_lib/respond';
import { fxAsOf, normalizeFx } from '../_lib/normalize';
import type { TpFxPayload, TpFxSnapshotPayload } from '$lib/api-types';

/**
 * `GET /api/fx` — doc 11 §3, upstream doc 10 §3.
 *
 * The weather endpoint's pipeline with two differences, both of them doc 10 §3's
 * doing.
 *
 * **No parameters.** ER-API's open endpoint is one-base-per-call, so this
 * caches exactly one USD table and the client divides for any pair it wants.
 * Sending a pair up would multiply one cache entry by 160² and buy nothing.
 *
 * **A write on the read path.** The first request of each published day also
 * stores that table permanently, because no keyless API sells VND history back
 * to us and the only way to have a history in a year is to start keeping one
 * now. doc 11 §3 calls it out as the one endpoint that is not side-effect-free,
 * and idempotent because it writes the same table under the same key or not at
 * all.
 *
 * Like Open-Meteo it needs no key, so nothing here is unreachable in tests or
 * in a fork.
 */

const LATEST = 'https://open.er-api.com/v6/latest/USD';

/** The breaker key, and the `source` every response carries. */
const UPSTREAM = 'er-api';

/**
 * doc 10 §3's `+ 5 min`: upstream's stated next-update instant is when the new
 * table *starts* being published, and asking at exactly that second is a race
 * with their own deploy. Five minutes past it, the table is really there.
 */
const NEXT_UPDATE_SLACK_MS = 5 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export const GET: RequestHandler = async ({ request, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	// No query to validate — doc 11 §3 gives this route no parameters, which is
	// the one step of the reference pipeline it legitimately has nothing to do.
	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const key = cacheKey.fx();
	const cached = await readCache<TpFxPayload>(kv, 'fx', key);

	if (cached.status === 'HIT' && cached.value) {
		return serve(cached.value, 'HIT', false);
	}

	const breaker = await readBreaker(kv, UPSTREAM);
	if (breakerVerdict(breaker, Date.now()) === 'open') {
		return serveStaleOr(cached);
	}

	try {
		const now = Date.now();
		const table = await fetchUpstream<Record<string, unknown>>(LATEST);

		/*
		 * Yesterday relative to *upstream's* publication, not to our clock.
		 *
		 * They push a little after UTC midnight, so for those few minutes
		 * `utcDateKey(now)` is already tomorrow while the table in hand is still
		 * yesterday's. Keyed on `now`, a request landing in that window would
		 * compare the table against itself and render a column of exact zeros —
		 * which looks like a calm market rather than like a bug.
		 */
		const asOf = fxAsOf(table.data, now);
		const prevDate = utcDateKey(asOf - DAY_MS);
		const previous = await readCache<TpFxSnapshotPayload>(
			kv,
			'fxSnap',
			cacheKey.fxSnapshot(prevDate)
		);

		const payload = normalizeFx(
			table.data,
			previous.value === null ? null : { date: prevDate, rates: previous.value.payload.rates },
			now
		);

		/*
		 * An answer with no rates in it is not an answer. ER-API replies 200 with
		 * `result: "error"` and no `rates` key for a malformed request or an
		 * outage, and `normalizeFx` is total by design, so without this the
		 * endpoint would cheerfully cache an empty table for twelve hours and
		 * every tile would show an em dash with no error anywhere.
		 */
		if (Object.keys(payload.rates).length === 0) {
			throw new UpstreamError('er-api returned no usable rates', 'malformed');
		}

		const freshUntil =
			payload.nextUpdateAt === null ? undefined : payload.nextUpdateAt + NEXT_UPDATE_SLACK_MS;

		// doc 11 §8: persistence rides on waitUntil so the response does not wait
		// on it, and so a throttled KV write cannot turn a good fetch into a 500.
		const persist = Promise.all([
			writeCache(
				kv,
				'fx',
				key,
				payload,
				UPSTREAM,
				now,
				freshUntil === undefined ? {} : { freshUntil }
			),
			snapshot(kv, payload, now),
			recordSuccess(kv, UPSTREAM)
		]).catch(() => undefined);
		if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(persist);
		else void persist;

		return ok(
			payload,
			{ cachedAt: Math.floor(now / 1000), source: UPSTREAM, stale: false },
			'MISS',
			ttlSeconds('fx', freshUntil, now)
		);
	} catch (error) {
		const upstream = error instanceof UpstreamError ? error : null;

		const immediate = upstream?.status === 429 || upstream?.status === 418;
		await recordFailure(kv, UPSTREAM, upstream?.message ?? String(error), { immediate }).catch(
			() => undefined
		);

		if (upstream?.status && upstream.status >= 400 && upstream.status < 500 && !immediate) {
			return fail('BAD_REQUEST');
		}
		return serveStaleOr(cached);
	}
};

/**
 * doc 10 §3's snapshot-on-read, and the reason `/api/fx/history` has anything
 * to assemble.
 *
 * Written under the date upstream published rather than the date we asked, and
 * only when that date has nothing yet — a second write the same day would be
 * the same numbers under the same key, but the read that avoids it is cheaper
 * than the write that would not.
 *
 * Deliberately not `Promise.all`-parallel with the rate write above: it reads
 * before it writes, and the whole thing is inside `waitUntil` where latency
 * costs nobody anything.
 */
async function snapshot(kv: KVNamespace, payload: TpFxPayload, now: number): Promise<void> {
	const key = cacheKey.fxSnapshot(utcDateKey(payload.asOf));
	const existing = await readCache<TpFxSnapshotPayload>(kv, 'fxSnap', key);
	if (existing.value !== null) return;

	await writeCache<TpFxSnapshotPayload>(kv, 'fxSnap', key, { rates: payload.rates }, UPSTREAM, now);
}

function serve(value: CachedValue<TpFxPayload>, status: 'HIT' | 'STALE', stale: boolean): Response {
	return ok(
		value.payload,
		{ cachedAt: Math.floor(value.cachedAt / 1000), source: value.source, stale },
		status,
		// The header must not outlive the data behind it: an entry capped by
		// upstream advertises what is left of *its* window, not the family's.
		ttlSeconds('fx', value.freshUntil)
	);
}

/**
 * doc 11 §4: between the TTL and the stale window a cached value is served
 * **only** when upstream fails, flagged `stale: true` so the tile shows the
 * amber badge rather than pretending the rate is current.
 */
function serveStaleOr(cached: Awaited<ReturnType<typeof readCache<TpFxPayload>>>): Response {
	if (cached.value) return serve(cached.value, 'STALE', true);
	return fail('UPSTREAM_DOWN');
}
