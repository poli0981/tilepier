import { RATE_LIMIT } from '$lib/shared-constants';

/**
 * In-Worker soft limiter (doc 11 §7).
 *
 * The Cloudflare zone rule is the real wall; this exists so a burst gets a
 * clean `429` with a `retry-after` instead of a blocked connection, and so the
 * client backoff in doc 17 §5 has something to respond to.
 *
 * KV is eventually consistent, so the count is approximate. That is fine and
 * deliberate — see doc 11 §7. What matters is that **no raw IP is ever
 * stored**: the key is a SHA-256 of the address plus a salt that rotates
 * daily, so yesterday's counters cannot be correlated with today's
 * (doc 15 §7).
 */

async function dailySalt(kv: KVNamespace, utcDate: string): Promise<string> {
	const key = `kv:rl:salt:${utcDate}`;
	const existing = await kv.get(key);
	if (existing) return existing;

	const bytes = crypto.getRandomValues(new Uint8Array(16));
	const salt = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	// Two days, so a request straddling midnight still finds yesterday's salt.
	await kv.put(key, salt, { expirationTtl: 172_800 });
	return salt;
}

async function hashIp(ip: string, salt: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + salt));
	return [...new Uint8Array(digest)]
		.slice(0, 10)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export interface RateVerdict {
	allowed: boolean;
	retryAfterS: number;
}

/**
 * **Fails open, always.** Every KV touch here is wrapped, because the counter
 * is a single hot key per address per bucket and KV rate-limits writes to
 * roughly one per second per key. Measured on the deployed Worker: a burst of
 * 200 concurrent requests produced **11 HTTP 500s (5.5 %)** before this guard
 * existed — the limiter meant to protect the service was taking it down, and
 * the failed writes also meant the limit never actually engaged.
 *
 * doc 11 §7 already says the zone rule is the real wall and this is only a
 * soft, approximate layer. A soft layer must never be able to fail a request.
 */
export async function checkRateLimit(
	kv: KVNamespace,
	request: Request,
	now = Date.now()
): Promise<RateVerdict> {
	const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for');
	// No address to key on (local dev, an internal call) — do not invent one.
	if (!ip) return { allowed: true, retryAfterS: 0 };

	try {
		const utcDate = new Date(now).toISOString().slice(0, 10);
		const salt = await dailySalt(kv, utcDate);
		const bucket = Math.floor(now / RATE_LIMIT.bucketMs);
		const key = `kv:rl:${await hashIp(ip, salt)}:${bucket}`;

		const count = Number((await kv.get(key)) ?? '0') + 1;

		// Deliberately not awaited into the verdict: a throttled write must not
		// change whether this request is allowed. Under-counting is the
		// documented trade (doc 11 §7).
		void kv
			.put(key, String(count), { expirationTtl: Math.ceil(RATE_LIMIT.counterTtlMs / 1000) })
			.catch(() => undefined);

		if (count > RATE_LIMIT.maxPerBucket) {
			const msIntoBucket = now % RATE_LIMIT.bucketMs;
			return {
				allowed: false,
				retryAfterS: Math.max(1, Math.ceil((RATE_LIMIT.bucketMs - msIntoBucket) / 1000))
			};
		}
	} catch {
		// KV unavailable or throttled. Allow — the zone rule still applies.
	}

	return { allowed: true, retryAfterS: 0 };
}
