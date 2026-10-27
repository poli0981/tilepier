import { RATE_LIMIT } from '#lib/shared-constants.js';

/**
 * The Worker's rate limiter (doc 11 §7), on Cloudflare's Rate Limiting
 * binding: `API_LIMITER` for `/api/*` and `PAGE_LIMITER` for the pages the
 * Worker renders, both declared in `wrangler.jsonc` with {@link RATE_LIMIT}'s
 * numbers. `hooks.server.ts` asks it before anything else runs, so a route
 * nobody remembered to limit is limited anyway.
 *
 * Until 2026-10-27 this was a KV counter each route called for itself. It
 * wrote KV on every `/api/*` request, the app's highest-volume write, and KV's
 * one-write-per-second-per-key ceiling meant a burst under-counted exactly when
 * the count mattered (doc 22 §S3). The binding keeps its counters inside
 * Cloudflare's own location, costs nothing per call, and stores nothing of
 * TilePier's.
 *
 * Still per Cloudflare location and still approximate, as the platform states:
 * this layer turns a burst into a clean `429` with a `retry-after` that the
 * client's backoff (doc 17 §5) can act on. The zone rule in front of the Worker
 * is the wall.
 */

export interface RateVerdict {
	allowed: boolean;
	retryAfterS: number;
}

const ALLOWED: RateVerdict = { allowed: true, retryAfterS: 0 };

/**
 * Who a request counts against, or `null` for nobody.
 *
 * Only `cf-connecting-ip`, which Cloudflare's edge overwrites on every request.
 * The KV limiter fell back to `x-forwarded-for`, which a client writes itself,
 * so a client without the first header could have chosen its own key.
 *
 * An IPv6 address counts as its /64: one subscriber holds a whole /64 and can
 * rotate through it freely, so keying the full address would hand every
 * IPv6 reader an unlimited supply of fresh limits.
 *
 * A loopback address is `wrangler dev`, which stamps the local client's address
 * on every request and so would put the whole e2e suite on one counter.
 * Cloudflare's edge never sends one.
 */
export function clientKey(request: Request): string | null {
	const address = request.headers.get('cf-connecting-ip')?.trim().toLowerCase() ?? '';
	if (address === '') return null;

	if (!address.includes(':')) return address.startsWith('127.') ? null : address;

	// An IPv4-mapped IPv6 address is the IPv4 address it carries.
	if (address.includes('.')) {
		const v4 = address.slice(address.lastIndexOf(':') + 1);
		return v4.startsWith('127.') ? null : v4;
	}

	const groups = ipv6Groups(address);
	if (groups.join(':') === '0:0:0:0:0:0:0:1') return null;
	return `${groups.slice(0, 4).join(':')}::/64`;
}

/** An IPv6 address as eight groups, `::` expanded and leading zeros dropped. */
function ipv6Groups(address: string): string[] {
	const [head = '', tail] = address.split('::', 2);
	const front = head === '' ? [] : head.split(':');
	const back = tail === undefined || tail === '' ? [] : tail.split(':');
	const gap = tail === undefined ? 0 : Math.max(0, 8 - front.length - back.length);
	return [...front, ...Array<string>(gap).fill('0'), ...back].map((group) =>
		group.replace(/^0+(?=.)/, '')
	);
}

/**
 * A SHA-256 of the key is what the binding counts, so the address itself never
 * enters a store. No salt, unlike the KV counter's: a counter lives for one
 * period inside Cloudflare's limiter and nothing can read it back, so a
 * rotating salt would have nothing left to protect (doc 15 §7).
 */
async function digest(key: string): Promise<string> {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
	return [...new Uint8Array(bytes)]
		.slice(0, 16)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * **Fails open, always.** A missing binding (a fork that dropped it, a unit
 * test) and a throwing one both allow: a soft layer must never be able to fail
 * a request, which the KV limiter learned at 5.5 % HTTP 500 (doc 22 §S3).
 *
 * The binding says yes or no and nothing about when its window turns, so a
 * refusal names one whole period — never too early, at most one period late.
 */
export async function checkRateLimit(
	limiter: RateLimit | undefined,
	key: string
): Promise<RateVerdict> {
	if (limiter === undefined) return ALLOWED;
	try {
		const { success } = await limiter.limit({ key: await digest(key) });
		return success ? ALLOWED : { allowed: false, retryAfterS: RATE_LIMIT.bucketMs / 1000 };
	} catch {
		return ALLOWED;
	}
}
