import type { RequestHandler } from './$types';
import { hasDevToken } from '../_lib/dev-token';
import { healthReport } from '../_lib/health';
import { fail, okNoStore } from '../_lib/respond';

/**
 * `GET /api/_health` — doc 11 §9, the breaker rows of doc 13 §10.
 *
 * Breaker state for every upstream, today's Twelve Data spend, which keys this
 * deploy has, and the Cloudflare location that answered. It exists to measure
 * what `wrangler tail` and a KV read would, from somewhere that needs no
 * interactive login — Week 5a's Binance failure on production is the question
 * it was pulled forward to answer.
 *
 * **Without the operator's token it does not exist.** A missing, wrong, or
 * unconfigured token gets a bare 404, not a 401, so the endpoint cannot be
 * discovered by asking. And every answer is `no-store` (`okNoStore`): the
 * adapter replays cacheable GETs before this handler runs, so a cacheable
 * report would reach the next caller whatever they sent.
 */
export const GET: RequestHandler = async ({ request, platform }) => {
	if (!(await hasDevToken(request, platform?.env.DEV_DASH_TOKEN))) return notFound();

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const now = Date.now();
	const report = await healthReport(kv, platform.env, platform.cf?.colo ?? null, now);
	return okNoStore(report, { cachedAt: Math.floor(now / 1000), source: 'health', stale: false });
};

/** Deliberately bare: no envelope, nothing that says an endpoint is here. */
function notFound(): Response {
	return new Response('Not Found', {
		status: 404,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }
	});
}
