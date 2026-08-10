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
	const age = now - value.cachedAt;
	const policy = CACHE_POLICY[family];

	return { value, status: age <= policy.ttlMs ? 'HIT' : 'STALE' };
}

export async function writeCache<T>(
	kv: KVNamespace,
	family: TpCacheFamily,
	key: string,
	payload: T,
	source: string,
	now = Date.now()
): Promise<CachedValue<T>> {
	const policy = CACHE_POLICY[family];
	const value: CachedValue<T> = { cachedAt: now, source, payload };

	// `fxSnap` is permanent — it *is* the currency history (doc 10 §3), so it
	// gets no expiration at all.
	const options =
		policy.staleMs === null || !Number.isFinite(policy.ttlMs)
			? {}
			: { expirationTtl: Math.ceil((policy.ttlMs + policy.staleMs) / 1000) };

	await kv.put(`${KV_PREFIX}${key}`, JSON.stringify(value), options);
	return value;
}

/** TTL in seconds, for the `cache-control` header. */
export function ttlSeconds(family: TpCacheFamily): number {
	const ttl = CACHE_POLICY[family].ttlMs;
	return Number.isFinite(ttl) ? Math.floor(ttl / 1000) : 0;
}
