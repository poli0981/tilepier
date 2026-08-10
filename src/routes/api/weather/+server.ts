import type { RequestHandler } from './$types';
import { cacheKey } from '$lib/shared-constants';
import { readCache, ttlSeconds, writeCache } from '../_lib/kv-cache';
import { breakerVerdict, readBreaker, recordFailure, recordSuccess } from '../_lib/breaker';
import { checkRateLimit } from '../_lib/ratelimit';
import { fetchUpstream, UpstreamError } from '../_lib/upstream';
import { fail, isCrossSite, ok } from '../_lib/respond';
import { geohash, parseCoords } from '../_lib/geohash';

/**
 * `GET /api/weather?lat&lon` — doc 11 §3, upstream doc 10 §2.
 *
 * The reference implementation of the doc 11 §2 pipeline: validate →
 * rate-gate → KV read → upstream (maybe) → normalize → KV write → respond.
 * Every other endpoint follows this shape.
 *
 * Open-Meteo needs no key, which is why S3 could measure this one for real.
 */

const FORECAST =
	'https://api.open-meteo.com/v1/forecast' +
	'?hourly=temperature_2m,precipitation_probability,precipitation,weather_code,' +
	'wind_speed_10m,wind_direction_10m,relative_humidity_2m,uv_index,surface_pressure' +
	'&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,' +
	'precipitation_probability_max&timezone=auto&forecast_days=7';

const AIR_QUALITY =
	'https://air-quality-api.open-meteo.com/v1/air-quality' +
	'?hourly=european_aqi,pm2_5,pm10,ozone,nitrogen_dioxide&forecast_days=1';

/** Our shape, not Open-Meteo's — schema-version isolation (doc 10 §2). */
interface TpWeatherPayload {
	place: { lat: number; lon: number; timezone: string };
	hourly: unknown;
	daily: unknown;
	airQuality: unknown | null;
	attribution: string;
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
	if (isCrossSite(request)) return new Response(null, { status: 403 });

	const kv = platform?.env.TILEPIER_CACHE;
	if (!kv) return fail('UPSTREAM_DOWN');

	const coords = parseCoords(url);
	if (!coords) return fail('BAD_REQUEST');

	const limit = await checkRateLimit(kv, request);
	if (!limit.allowed) return fail('RATE_LIMITED', limit.retryAfterS);

	const key = cacheKey.weather(geohash(coords.lat, coords.lon));
	const cached = await readCache<TpWeatherPayload>(kv, 'wx', key);

	if (cached.status === 'HIT' && cached.value) {
		return ok(
			cached.value.payload,
			{
				cachedAt: Math.floor(cached.value.cachedAt / 1000),
				source: cached.value.source,
				stale: false
			},
			'HIT',
			ttlSeconds('wx')
		);
	}

	// Past the TTL, or nothing cached. Ask the breaker before touching upstream.
	const breaker = await readBreaker(kv, 'open-meteo');
	const verdict = breakerVerdict(breaker, Date.now());

	if (verdict === 'open') {
		return serveStaleOr(cached, 'UPSTREAM_DOWN');
	}

	try {
		// Forecast and air quality in parallel — doc 10 §2 bundles AQI into the
		// weather payload, and two sequential round trips would double latency
		// on a cache miss for no reason.
		const [forecast, air] = await Promise.allSettled([
			fetchUpstream<Record<string, unknown>>(
				`${FORECAST}&latitude=${coords.lat}&longitude=${coords.lon}`
			),
			fetchUpstream<Record<string, unknown>>(
				`${AIR_QUALITY}&latitude=${coords.lat}&longitude=${coords.lon}`
			)
		]);

		if (forecast.status === 'rejected') throw forecast.reason;

		const payload: TpWeatherPayload = {
			place: {
				lat: coords.lat,
				lon: coords.lon,
				timezone: String(forecast.value.data.timezone ?? 'UTC')
			},
			hourly: forecast.value.data.hourly ?? null,
			daily: forecast.value.data.daily ?? null,
			// AQI is a nice-to-have: a failure there must not cost the forecast.
			airQuality: air.status === 'fulfilled' ? (air.value.data.hourly ?? null) : null,
			// Carried in the payload so the UI cannot forget it (doc 10 §3).
			attribution: 'Weather data by Open-Meteo (CC BY 4.0)'
		};

		// doc 11 §8: cache persistence rides on waitUntil so the response does
		// not wait on it — and, just as importantly, so a throttled KV write
		// cannot turn a good upstream fetch into a 500. Measured on the deployed
		// Worker before this change: 11 of 200 concurrent requests failed.
		const cachedAt = Date.now();
		const persist = Promise.all([
			writeCache(kv, 'wx', key, payload, 'open-meteo', cachedAt),
			recordSuccess(kv, 'open-meteo')
		]).catch(() => undefined);
		if (platform?.ctx?.waitUntil) platform.ctx.waitUntil(persist);
		else void persist;

		return ok(
			payload,
			{ cachedAt: Math.floor(cachedAt / 1000), source: 'open-meteo', stale: false },
			'MISS',
			ttlSeconds('wx')
		);
	} catch (error) {
		const upstream = error instanceof UpstreamError ? error : null;

		// 429/418 mean upstream is telling us to stop, so open immediately
		// rather than after three strikes (doc 11 §6).
		const immediate = upstream?.status === 429 || upstream?.status === 418;
		// Best-effort as well: breaker bookkeeping must not mask the real error.
		await recordFailure(kv, 'open-meteo', upstream?.message ?? String(error), {
			immediate
		}).catch(() => undefined);

		if (upstream?.status && upstream.status >= 400 && upstream.status < 500 && !immediate) {
			return fail('BAD_REQUEST');
		}
		return serveStaleOr(cached, 'UPSTREAM_DOWN');
	}
};

/**
 * doc 11 §4: between the TTL and the stale window, a cached value is served
 * **only** when upstream fails — flagged `stale: true` so the tile shows the
 * amber badge rather than pretending the data is current.
 */
function serveStaleOr(
	cached: Awaited<ReturnType<typeof readCache<TpWeatherPayload>>>,
	code: 'UPSTREAM_DOWN' | 'QUOTA_EXHAUSTED'
): Response {
	if (cached.value) {
		return ok(
			cached.value.payload,
			{
				cachedAt: Math.floor(cached.value.cachedAt / 1000),
				source: cached.value.source,
				stale: true
			},
			'STALE',
			ttlSeconds('wx')
		);
	}
	return fail(code);
}
