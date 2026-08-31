import type { RequestHandler } from './$types';
import { checkRateLimit } from '../../_lib/ratelimit';
import { fail, isCrossSite, ok } from '../../_lib/respond';
import { ttlSeconds } from '../../_lib/kv-cache';
import { parseFxHistoryQuery } from '../../_lib/fx-history-query';
import { assembleHistory, readSnapshots, snapshotDates } from '../../_lib/fx-snapshots';
import { FX_ATTRIBUTION } from '../../_lib/normalize';
import type { TpFxHistoryPayload } from '$lib/api-types';

/**
 * `GET /api/fx/history?pair=USD-VND&days=90` — doc 11 §3, doc 10 §3.
 *
 * **The one endpoint with no upstream.** Every point it returns was written by
 * `/api/fx` on some earlier day and has sat in KV without an expiry ever since,
 * because no keyless API sells VND history back to us and the only way to have
 * one in a year is to have started keeping it. So this route legitimately skips
 * two steps of the doc 11 §2 pipeline: there is nothing to fetch and therefore
 * no breaker to consult, and a failure here is a failure to read our own store.
 *
 * **It reports `HIT` and never `MISS`**, because every byte came out of KV.
 * The `max-age` is borrowed from the `fx` family — the data behind it is that
 * family's, and one more point appears per day — but there is no cache *entry*
 * for the assembled series and deliberately so: a new `CACHE_POLICY` family is
 * four coupled edits (the policy, the key builder, doc 11 §4's table, and the
 * drift test that parses it) for a derived value whose inputs are already
 * permanent, and Cloudflare's own CDN absorbs the repeat-hit shape here, which
 * is every reader asking for the same pair and range.
 *
 * **An empty window is a 200, not a failure.** doc 08 §2's "history builds
 * daily from launch" is a state the UI renders, and an empty series is its
 * honest representation on the wire.
 */

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const query = parseFxHistoryQuery(url);
	if (!query) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const dates = snapshotDates(query.days, Date.now());
	const tables = await readSnapshots(kv, dates);
	const points = assembleHistory(query.base, query.quote, dates, tables);

	const payload: TpFxHistoryPayload = {
		base: query.base,
		quote: query.quote,
		points,
		attribution: FX_ATTRIBUTION
	};

	// The newest point is when this series was last true. Stamping it with the
	// clock instead would call a chart that stops three days ago current, which
	// is exactly the lie `meta.cachedAt` exists to prevent.
	const newest = points.at(-1);
	const cachedAt = newest === undefined ? Date.now() : Date.parse(`${newest.date}T00:00:00Z`);

	return ok(
		payload,
		{ cachedAt: Math.floor(cachedAt / 1000), source: 'er-api', stale: false },
		'HIT',
		ttlSeconds('fx')
	);
};
