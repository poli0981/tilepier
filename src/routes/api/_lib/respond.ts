import type { TpApiErrorCode, TpApiMeta, TpApiResponse, TpCacheStatus } from '$lib/api-types';

/**
 * The response envelope, doc 11 §2. Every `/api/*` endpoint returns through
 * here so upstream quirks die at the edge and the client only ever parses one
 * shape.
 */

export function ok<T>(
	data: T,
	meta: TpApiMeta,
	cache: TpCacheStatus,
	ttlSeconds: number
): Response {
	const body: TpApiResponse<T> = { ok: true, data, meta };
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			'x-tp-cache': cache,
			// Half the TTL, so the CF CDN and the browser absorb repeat hits
			// without ever serving something the edge considers stale (doc 11 §2).
			'cache-control': `public, max-age=${Math.max(0, Math.floor(ttlSeconds / 2))}`
		}
	});
}

const STATUS: Record<TpApiErrorCode, number> = {
	BAD_REQUEST: 400,
	RATE_LIMITED: 429,
	QUOTA_EXHAUSTED: 503,
	UPSTREAM_DOWN: 503
};

export function fail(code: TpApiErrorCode, retryAfterS?: number): Response {
	const body = { ok: false as const, error: retryAfterS ? { code, retryAfterS } : { code } };
	const headers: Record<string, string> = {
		'content-type': 'application/json; charset=utf-8'
	};
	if (retryAfterS) headers['retry-after'] = String(retryAfterS);

	return new Response(JSON.stringify(body), { status: STATUS[code], headers });
}

/**
 * doc 15 §3.2: a browser sending `Sec-Fetch-Site: cross-site` to `/api/*` is
 * another site embedding ours, so refuse. A missing header (curl, a server) is
 * allowed — the data is public and the goal is deterring mass embedding, not
 * building an auth system.
 */
export function isCrossSite(request: Request): boolean {
	return request.headers.get('sec-fetch-site') === 'cross-site';
}
