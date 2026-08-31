import { SvelteMap } from 'svelte/reactivity';
import { BACKOFF, HARD_MAX_AGE_MS } from '$lib/shared-constants';
import { online } from '$lib/stores/online.svelte';
import { toasts } from '$lib/stores/toast.svelte';
import { isRetryable, TpApiError, type TpApiErrorCode } from './api';
import { logEntry } from './log-buffer';
import { db, type TpDb } from './storage/db';

/**
 * Stale-while-revalidate (doc 04 §2) — the single primitive every networked
 * widget reads through.
 *
 * A `.svelte.ts` module because what it hands back is rune-backed state: doc 04
 * §2 says "emit" four times, and this is what it emits through.
 *
 * The split with `api.ts` is deliberate. That module knows what an `/api/*`
 * failure *means*; this one knows what to do about it — cache, de-duplicate,
 * decide a status, and stay quiet when the network is gone. Neither has to fake
 * the other to be tested.
 */

/** doc 04 §2. */
export type TpSwrStatus =
	'idle' | 'loading' | 'fresh' | 'stale' | 'stale-error' | 'offline' | 'error' | 'rate-limited';

export interface TpSwrHandle<T> {
	readonly data: T | undefined;
	readonly status: TpSwrStatus;
	readonly error: TpApiErrorCode | undefined;
	readonly cachedAt: number | undefined;
	readonly ageMs: number | undefined;
	/** Rejects on failure — backoff belongs to the scheduler (doc 04 §2–§3). */
	revalidate(reason?: string): Promise<void>;
	/** Drop this caller's subscription. The entry goes with the last one. */
	release(): void;
}

export interface TpSwrOptions {
	/** Client freshness window. Deliberately ≥ the Worker's KV TTL (doc 04 §2). */
	ttlMs: number;
	/** Beyond this, a cached payload is not rendered at all. */
	hardMaxAgeMs?: number;
}

export type TpSwrFetcher<T> = (signal: AbortSignal) => Promise<T>;

/** One row of the doc 13 §10 §8 diagnostics table. */
export interface TpSwrSnapshot {
	key: string;
	status: TpSwrStatus;
	cachedAt: number | null;
	ageMs: number | null;
	error: TpApiErrorCode | null;
	refs: number;
	inFlight: boolean;
}

class Entry<T> {
	readonly key: string;
	readonly ttlMs: number;
	readonly hardMaxAgeMs: number;

	/**
	 * `$state.raw`, and it is load-bearing twice over. A payload is replaced
	 * wholesale and never mutated, so a deep proxy would cost a hop on every
	 * read for nothing — and, more sharply, **IndexedDB cannot structured-clone
	 * a `Proxy`**. Writing a deep-proxied payload back into `apiCache` is
	 * exactly the `DataCloneError` that made every backup import fail silently
	 * in Week 2 (doc 05 §6).
	 */
	payload = $state.raw<T | undefined>(undefined);
	cachedAt = $state<number | undefined>(undefined);
	phase = $state<'idle' | 'loading' | 'ready' | 'failed'>('idle');
	errorCode = $state<TpApiErrorCode | undefined>(undefined);
	refs = 0;
	hydrated = false;
	inFlight: Promise<void> | null = null;
	controller: AbortController | null = null;
	fetcher: TpSwrFetcher<T>;

	constructor(key: string, fetcher: TpSwrFetcher<T>, options: TpSwrOptions) {
		this.key = key;
		this.fetcher = fetcher;
		this.ttlMs = options.ttlMs;
		this.hardMaxAgeMs = options.hardMaxAgeMs ?? HARD_MAX_AGE_MS;
	}

	get ageMs(): number | undefined {
		if (this.cachedAt === undefined) return undefined;
		return Math.max(0, Date.now() - this.cachedAt);
	}

	/**
	 * doc 04 §2: beyond `hardMaxAgeMs` a cached payload is not rendered at all.
	 * A week-old forecast is not stale data, it is the wrong data.
	 */
	get visible(): T | undefined {
		const age = this.ageMs;
		if (this.payload === undefined) return undefined;
		if (age !== undefined && age > this.hardMaxAgeMs) return undefined;
		return this.payload;
	}

	get status(): TpSwrStatus {
		const data = this.visible;

		if (this.errorCode !== undefined) {
			// doc 04 §2's error table. The two that depend on having something to
			// show are the ones where the difference is visible to the reader:
			// with a payload the tile degrades, without one it fails.
			switch (this.errorCode) {
				case 'NETWORK':
					return 'offline';
				case 'RATE_LIMITED':
					return 'rate-limited';
				case 'BAD_REQUEST':
					return 'error';
				default:
					return data === undefined ? 'error' : 'stale-error';
			}
		}

		if (data === undefined) return this.phase === 'loading' ? 'loading' : 'idle';

		const age = this.ageMs ?? 0;
		return age <= this.ttlMs ? 'fresh' : 'stale';
	}
}

/**
 * A `SvelteMap` rather than a `Map`, and not only because eslint says so: the
 * diagnostics table (doc 13 §10 §8) renders from `inspect()`, and a plain map
 * would leave it showing whatever was there when the panel mounted. Membership
 * changes when a tile is added or removed, which is exactly when a reader
 * looking at that table wants to see it change.
 */
const entries = new SvelteMap<string, Entry<unknown>>();

/**
 * doc 17 §5: at most one rate-limit toast per window however many widgets trip
 * at once. The coordinator lives here because this is the only module that sees
 * every 429. The component it drives arrived in Week 4b with `currency`, which
 * is the first widget on the deck that can produce a 429 at all.
 */
let lastRateLimitNoticeAt = 0;

function noteRateLimited(key: string, now: number): boolean {
	if (now - lastRateLimitNoticeAt < BACKOFF.toastThrottleMs) return false;
	lastRateLimitNoticeAt = now;
	logEntry('warn', `rate limited on ${key}`, { src: 'swr' });
	return true;
}

/** The client mirror of the Worker's KV entry (doc 04 §1, doc 05 §3). */
async function readCache<T>(
	key: string,
	target: TpDb
): Promise<{ payload: T; cachedAt: number } | null> {
	try {
		const row = await target.apiCache.get(key);
		if (row === undefined) return null;
		return { payload: row.payload as T, cachedAt: row.cachedAt };
	} catch (error) {
		// A read failure is not worth taking the tile down for: the fetch below
		// is about to run anyway, and doc 05 §5's readers all fail closed.
		logEntry('warn', `could not read apiCache for ${key}`, { src: 'swr', error });
		return null;
	}
}

async function writeCache<T>(
	key: string,
	payload: T,
	cachedAt: number,
	target: TpDb
): Promise<void> {
	try {
		await target.apiCache.put({ key, cachedAt, payload });
	} catch (error) {
		logEntry('warn', `could not write apiCache for ${key}`, { src: 'swr', error });
	}
}

async function run<T>(entry: Entry<T>, target: TpDb): Promise<void> {
	// De-dupe: concurrent callers share one in-flight promise (doc 04 §2.5).
	if (entry.inFlight !== null) return entry.inFlight;

	const controller = new AbortController();
	entry.controller = controller;
	entry.phase = 'loading';

	const attempt = (async () => {
		try {
			const payload = await entry.fetcher(controller.signal);
			entry.payload = payload;
			entry.cachedAt = Date.now();
			entry.phase = 'ready';
			entry.errorCode = undefined;
			online.noteFetchResult('ok');
			await writeCache(entry.key, payload, entry.cachedAt, target);
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				// The caller replaced this request. Not a failure, and not an
				// error state — the run that superseded it owns the outcome.
				entry.phase = entry.payload === undefined ? 'idle' : 'ready';
				throw error;
			}

			const code = error instanceof TpApiError ? error.code : 'NETWORK';
			entry.errorCode = code;
			entry.phase = 'failed';

			online.noteFetchResult(code === 'NETWORK' ? 'network-error' : 'ok');

			// doc 17 §5: the coordinator decides *whether*, the store decides *how long*.
			if (code === 'RATE_LIMITED' && noteRateLimited(entry.key, Date.now())) {
				toasts.show('rate-limited');
			}
			if (!isRetryable(code)) {
				// doc 17 §4: a `BAD_REQUEST` is this build asking wrongly. Loud,
				// because nothing else will ever surface it.
				logEntry('error', `swr ${entry.key}: ${code}`, { src: 'swr', error });
			}

			// doc 04 §2: rejects rather than swallowing, so the scheduler owns
			// the retry curve (doc 04 §3, doc 17 §5).
			throw error;
		} finally {
			entry.inFlight = null;
			if (entry.controller === controller) entry.controller = null;
		}
	})();

	entry.inFlight = attempt;
	return attempt;
}

/**
 * Subscribe to a data key. Concurrent callers with the same key share one
 * entry, one cache row and one in-flight request — two weather tiles pinned to
 * the same place must not fetch twice for one payload (doc 04 §3).
 *
 * `target` is the Dexie database; it is a parameter so the suite can drive a
 * throwaway one rather than the reader's own.
 */
export function swr<T>(
	key: string,
	fetcher: TpSwrFetcher<T>,
	options: TpSwrOptions,
	target: TpDb = db
): TpSwrHandle<T> {
	let entry = entries.get(key) as Entry<T> | undefined;

	if (entry === undefined) {
		entry = new Entry<T>(key, fetcher, options);
		entries.set(key, entry as Entry<unknown>);
	} else {
		// A later subscriber's fetcher replaces the earlier one. They are the
		// same request by construction — the key *is* the request — and holding
		// the first would pin a closure from a component that may be unmounting.
		entry.fetcher = fetcher;
	}

	const own = entry;
	own.refs += 1;

	if (!own.hydrated) {
		own.hydrated = true;
		// doc 04 §2.1: read Dexie first and emit immediately, then decide whether
		// to revalidate. A tile shows last-good data in its first frame rather
		// than a skeleton over something already on the device.
		void readCache<T>(key, target).then((row) => {
			if (row !== null && own.payload === undefined) {
				own.payload = row.payload;
				own.cachedAt = row.cachedAt;
				own.phase = 'ready';
			}
			// doc 04 §2.4: offline means do not try. The scheduler wakes every
			// paused entry on the `online` event.
			const age = own.ageMs;
			const needsFetch = age === undefined || age > own.ttlMs;
			if (needsFetch && online.isOnline) void run(own, target).catch(() => undefined);
		});
	}

	let released = false;

	return {
		get data() {
			return own.visible;
		},
		get status() {
			return own.status;
		},
		get error() {
			return own.errorCode;
		},
		get cachedAt() {
			return own.cachedAt;
		},
		get ageMs() {
			return own.ageMs;
		},
		async revalidate() {
			await run(own, target);
		},
		release() {
			// Idempotent: a component that unmounts twice under a boundary reset
			// must not take another subscriber's entry down with it.
			if (released) return;
			released = true;
			own.refs -= 1;
			if (own.refs > 0) return;
			// doc 04 §2.5: the dedupe map must not grow with the deck.
			own.controller?.abort();
			entries.delete(key);
		}
	};
}

export const swrCache = {
	/** doc 13 §10 §8's cache-age rows. A snapshot, never the live entries. */
	inspect(): readonly TpSwrSnapshot[] {
		return [...entries.values()].map((entry) => ({
			key: entry.key,
			status: entry.status,
			cachedAt: entry.cachedAt ?? null,
			ageMs: entry.ageMs ?? null,
			error: entry.errorCode ?? null,
			refs: entry.refs,
			inFlight: entry.inFlight !== null
		}));
	},

	/** How many keys are live. The mirror of `scheduler.size`. */
	get size(): number {
		return entries.size;
	},

	/** Test seam. Never called in production. */
	reset(): void {
		for (const entry of entries.values()) entry.controller?.abort();
		entries.clear();
		lastRateLimitNoticeAt = 0;
	}
};
