/**
 * Types shared by the client and the Worker (doc 03 §Module boundaries).
 *
 * This is the *only* module both sides import. `routes/api/*` must never pull
 * from `widgets/*` — server code dragging in a component graph is how a Worker
 * bundle quietly triples in size.
 */

/** doc 11 §2. */
export type TpApiErrorCode = 'UPSTREAM_DOWN' | 'RATE_LIMITED' | 'BAD_REQUEST' | 'QUOTA_EXHAUSTED';

export interface TpApiMeta {
	/** Unix seconds when the payload was fetched from upstream. */
	cachedAt: number;
	/** Which upstream produced it — `open-meteo`, `binance`, `stooq`, … */
	source: string;
	/** True when served past its TTL because upstream failed or the breaker is open. */
	stale: boolean;
}

interface TpApiOk<T> {
	ok: true;
	data: T;
	meta: TpApiMeta;
}

interface TpApiErr {
	ok: false;
	error: {
		code: TpApiErrorCode;
		retryAfterS?: number;
	};
}

export type TpApiResponse<T> = TpApiOk<T> | TpApiErr;

/** `x-tp-cache` header values (doc 11 §2). */
export type TpCacheStatus = 'HIT' | 'MISS' | 'STALE';
