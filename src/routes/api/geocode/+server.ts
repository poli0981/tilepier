import type { RequestHandler } from './$types';
import type { TpGeocodePayload, TpGeocodeResult } from '$lib/api-types';
import { cacheKey } from '$lib/shared-constants';
import { breakerVerdict, readBreaker, recordFailure, recordSuccess } from '../_lib/breaker';
import { readCache, ttlSeconds, writeCache } from '../_lib/kv-cache';
import { normalizeNominatim, normalizePhoton } from '../_lib/normalize';
import { checkRateLimit } from '../_lib/ratelimit';
import { fail, isCrossSite, ok } from '../_lib/respond';
import { fetchUpstream, UpstreamError } from '../_lib/upstream';
import { parseGeocodeQuery, type TpGeocodeQuery } from '../_lib/geocode-query';

/**
 * `GET /api/geocode?q&lang` — doc 11 §3, upstreams doc 10 §6.
 *
 * Photon first, Nominatim as the fallback. Both are fair-use services run by
 * volunteers, and **Nominatim's policy requires caching and an identifying
 * User-Agent** — the 24 h TTL in doc 11 §4 is not an optimisation here, it is
 * the condition of use. Photon leads because it has no such requirement and is
 * faster; Nominatim only sees traffic Photon could not answer.
 *
 * Same pipeline as `/api/weather`: validate → rate-gate → KV read → upstream →
 * normalize → KV write → respond.
 */

const PHOTON = 'https://photon.komoot.io/api/';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

/** doc 10 §6: mandatory, and the reason this endpoint may use Nominatim at all. */
const NOMINATIM_UA = 'TilePier/1.0 (tilepier.win)';

/** doc 10 §6's `limit=5`. A search box shows five rows; asking for more spends
 *  a volunteer service's capacity on results nobody scrolls to. */
const LIMIT = 5;

const ATTRIBUTION = 'Search by Photon/komoot, data © OpenStreetMap contributors (ODbL)';

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const parsed = parseGeocodeQuery(url);
	if (parsed === null) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const key = cacheKey.geocode(parsed.lang, parsed.qNorm);
	const cached = await readCache<TpGeocodePayload>(kv, 'geo', key);

	if (cached.status === 'HIT' && cached.value) {
		return ok(
			cached.value.payload,
			{
				cachedAt: Math.floor(cached.value.cachedAt / 1000),
				source: cached.value.source,
				stale: false
			},
			'HIT',
			ttlSeconds('geo')
		);
	}

	const attempt = await search(parsed);

	if (attempt === null) {
		// doc 11 §4: past the TTL, a cached value is served only when upstream
		// fails — flagged, so the client shows it for what it is.
		if (cached.value) {
			return ok(
				cached.value.payload,
				{
					cachedAt: Math.floor(cached.value.cachedAt / 1000),
					source: cached.value.source,
					stale: true
				},
				'STALE',
				ttlSeconds('geo')
			);
		}
		return fail('UPSTREAM_DOWN');
	}

	const payload: TpGeocodePayload = {
		query: parsed.q,
		results: attempt.results,
		attribution: ATTRIBUTION
	};

	// **Zero results are cached.** A search that found nothing is an answer, and
	// re-asking two volunteer-run services the same unanswerable question every
	// keystroke is exactly what their fair-use policies are about.
	const cachedAt = Date.now();
	const persist = Promise.all([
		writeCache(kv, 'geo', key, payload, attempt.source, cachedAt),
		recordSuccess(kv, attempt.source)
	]).catch(() => undefined);
	if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(persist);
	else void persist;

	return ok(
		payload,
		{ cachedAt: Math.floor(cachedAt / 1000), source: attempt.source, stale: false },
		'MISS',
		ttlSeconds('geo')
	);

	async function search(
		query: TpGeocodeQuery
	): Promise<{ results: TpGeocodeResult[]; source: string } | null> {
		const photon = await tryPhoton(query);
		if (photon !== null) return { results: photon, source: 'photon' };

		const nominatim = await tryNominatim(query);
		if (nominatim !== null) return { results: nominatim, source: 'nominatim' };

		return null;
	}

	async function tryPhoton(query: TpGeocodeQuery): Promise<TpGeocodeResult[] | null> {
		const breaker = await readBreaker(kv!, 'photon');
		if (breakerVerdict(breaker, Date.now()) === 'open') return null;

		try {
			const params = new URLSearchParams({
				q: query.q,
				limit: String(LIMIT),
				lang: query.lang === 'vi' ? 'default' : 'en'
			});
			const response = await fetchUpstream<unknown>(`${PHOTON}?${params.toString()}`);
			return normalizePhoton(response.data);
		} catch (error) {
			await noteFailure('photon', error);
			return null;
		}
	}

	async function tryNominatim(query: TpGeocodeQuery): Promise<TpGeocodeResult[] | null> {
		const breaker = await readBreaker(kv!, 'nominatim');
		if (breakerVerdict(breaker, Date.now()) === 'open') return null;

		try {
			const params = new URLSearchParams({
				q: query.q,
				format: 'jsonv2',
				limit: String(LIMIT),
				'accept-language': query.lang
			});
			const response = await fetchUpstream<unknown>(`${NOMINATIM}?${params.toString()}`, {
				// doc 10 §6: not optional. Nominatim blocks anonymous clients, and
				// rightly — it is a volunteer service.
				headers: { 'user-agent': NOMINATIM_UA }
			});
			return normalizeNominatim(response.data);
		} catch (error) {
			await noteFailure('nominatim', error);
			return null;
		}
	}

	async function noteFailure(upstream: string, error: unknown): Promise<void> {
		const upstreamError = error instanceof UpstreamError ? error : null;
		// 429/418 are upstream telling us to stop, so open at once rather than
		// after three strikes (doc 11 §6) — which matters more here than
		// anywhere, since these are two services run on donated capacity.
		const immediate = upstreamError?.status === 429 || upstreamError?.status === 418;
		await recordFailure(kv!, upstream, upstreamError?.message ?? String(error), {
			immediate
		}).catch(() => undefined);
	}
};
