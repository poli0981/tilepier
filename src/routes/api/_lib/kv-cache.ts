import { CACHE_POLICY, KV_PREFIX, type TpCacheFamily } from '$lib/shared-constants';
import type { TpCacheStatus } from '$lib/api-types';

/**
 * KV cache with a stale-serve window (doc 11 §4).
 *
 * The shape stored in KV carries its own `cachedAt`, because KV's own
 * expiration cannot express "fresh for 600 s, then usable for 24 h but only if
 * upstream is down". Freshness is computed from the stamp; KV's
 * `expirationTtl` is set to ttl + stale so the entry disappears once even the
 * stale window has passed.
 */

export interface CachedValue<T> {
	cachedAt: number;
	source: string;
	payload: T;
	/**
	 * The instant past which this stops being fresh, when upstream told us
	 * something the doc 11 §4 table cannot express — `/api/fx` honouring
	 * `time_next_update_unix` (doc 10 §3) is the only case today.
	 *
	 * Stored rather than passed, and that is the whole point. A later
	 * `readCache` happens on a different request with no idea what cap the
	 * write applied, so a per-call parameter on `writeCache` alone would still
	 * report `HIT` for a table upstream refreshed ten hours ago. Absent on
	 * every entry written before Week 4b and on every family with no upstream
	 * opinion, which is what the `??` in `readCache` makes a non-event.
	 */
	freshUntil?: number;
}

export interface CacheRead<T> {
	value: CachedValue<T> | null;
	/** `HIT` inside the TTL, `STALE` past it but inside the stale window. */
	status: TpCacheStatus;
}

export async function readCache<T>(
	kv: KVNamespace,
	family: TpCacheFamily,
	key: string,
	now = Date.now()
): Promise<CacheRead<T>> {
	const raw = await kv.get(`${KV_PREFIX}${key}`, 'json');
	if (!raw) return { value: null, status: 'MISS' };

	const value = raw as CachedValue<T>;
	const policy = CACHE_POLICY[family];
	const freshUntil = value.freshUntil ?? value.cachedAt + policy.ttlMs;

	return { value, status: now <= freshUntil ? 'HIT' : 'STALE' };
}

export async function writeCache<T>(
	kv: KVNamespace,
	family: TpCacheFamily,
	key: string,
	payload: T,
	source: string,
	now = Date.now(),
	options: { freshUntil?: number } = {}
): Promise<CachedValue<T>> {
	const policy = CACHE_POLICY[family];
	const familyFreshUntil = now + policy.ttlMs;

	/*
	 * The cap may only ever *shorten*. An upstream claiming its next update is
	 * nine days out must not stretch a 12 h TTL to nine days — doc 11 §4's
	 * table stays the ceiling and upstream only ever moves the floor up.
	 *
	 * A cap already in the past is ignored rather than honoured: an entry born
	 * stale refetches on the very next request, so a wrong or long-past
	 * `time_next_update_unix` would turn one bad field upstream into a fetch
	 * per request. Falling back to the family TTL is the conservative answer,
	 * and the breaker is not the right tool for a mistake we can just not make.
	 */
	const capped =
		options.freshUntil === undefined || options.freshUntil <= now
			? undefined
			: Math.min(familyFreshUntil, options.freshUntil);

	const value: CachedValue<T> =
		capped === undefined
			? { cachedAt: now, source, payload }
			: { cachedAt: now, source, payload, freshUntil: capped };

	// `fxSnap` is permanent — it *is* the currency history (doc 10 §3), so it
	// gets no expiration at all.
	const options_ =
		policy.staleMs === null || !Number.isFinite(policy.ttlMs)
			? {}
			: {
					// The stale window is measured from the end of the freshness
					// window, so a shortened cap does not also shorten the
					// stale-serve grace it was never meant to touch.
					expirationTtl: Math.ceil(((capped ?? familyFreshUntil) - now + policy.staleMs) / 1000)
				};

	await kv.put(`${KV_PREFIX}${key}`, JSON.stringify(value), options_);
	return value;
}

/**
 * TTL in seconds, for the `cache-control` header.
 *
 * `freshUntil` narrows it to what is actually left of the window, so a response
 * served from an entry capped by upstream does not advertise a max-age that
 * outlives the data behind it.
 */
export function ttlSeconds(family: TpCacheFamily, freshUntil?: number, now = Date.now()): number {
	const ttl = CACHE_POLICY[family].ttlMs;
	const window = freshUntil === undefined ? ttl : Math.min(ttl, Math.max(0, freshUntil - now));

	return Number.isFinite(window) ? Math.floor(window / 1000) : 0;
}
