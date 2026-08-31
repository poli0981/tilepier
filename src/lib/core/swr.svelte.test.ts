import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TpApiError, type TpApiErrorCode } from './api';
import { createDb, type TpDb } from './storage/db';
import { online } from '$lib/stores/online.svelte';
import { toasts } from '$lib/stores/toast.svelte';
import { BACKOFF } from '$lib/shared-constants';
import { swr, swrCache, type TpSwrStatus } from './swr.svelte';

/**
 * doc 04 §2, and doc 19 §3.4's "dedupe, stale flag math, backoff caps".
 *
 * Browser project: this half holds runes and writes Dexie, and both need a real
 * browser. It needs no network mock at all — `swr` takes a fetcher, so a stub
 * function is a more precise instrument than MSW would be here. The envelope
 * half that *does* need MSW is `api.test.ts`, in node.
 */

const created: TpDb[] = [];

function freshDb(): TpDb {
	const db = createDb(`tilepier-swr-${crypto.randomUUID()}`);
	created.push(db);
	return db;
}

/** Resolves with `value`, and counts how many times it was asked. */
function stub<T>(value: T) {
	const fetcher = vi.fn(async () => Promise.resolve(value));
	return fetcher;
}

function failing(code: TpApiErrorCode) {
	return vi.fn(async () => {
		throw new TpApiError(code, `${code} in a test`);
	});
}

beforeEach(() => {
	swrCache.reset();
	online.reset();
	online.init();
	toasts.reset();
});

afterEach(async () => {
	swrCache.reset();
	online.reset();
	toasts.reset();
	while (created.length > 0) {
		const db = created.pop();
		await db?.delete();
	}
	vi.restoreAllMocks();
});

describe('the first read', () => {
	it('starts idle and reaches fresh', async () => {
		const db = freshDb();
		const handle = swr('t:1', stub({ n: 1 }), { ttlMs: 60_000 }, db);

		await vi.waitFor(() => {
			expect(handle.status).toBe('fresh');
		});
		expect(handle.data).toEqual({ n: 1 });
		expect(handle.error).toBeUndefined();
		handle.release();
	});

	it('persists what it fetched into apiCache', async () => {
		// doc 04 §1: the client mirror of the Worker's KV entry, under the same
		// key string, so debugging correlates 1:1.
		const db = freshDb();
		const handle = swr('t:2', stub({ n: 2 }), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('fresh');
		});

		const row = await db.apiCache.get('t:2');
		expect(row?.payload).toEqual({ n: 2 });
		handle.release();
	});

	it('emits the cached payload before fetching anything', async () => {
		// doc 04 §2.1. A tile shows last-good data in its first frame rather than
		// a skeleton over something already on the device.
		const db = freshDb();
		await db.apiCache.put({ key: 't:3', cachedAt: Date.now(), payload: { n: 'cached' } });

		const fetcher = stub({ n: 'fetched' });
		const handle = swr('t:3', fetcher, { ttlMs: 60_000 }, db);

		await vi.waitFor(() => {
			expect(handle.data).toEqual({ n: 'cached' });
		});
		expect(handle.status).toBe('fresh');
		// Inside the TTL, so nothing was asked of the network at all.
		expect(fetcher).not.toHaveBeenCalled();
		handle.release();
	});

	it('revalidates a cached payload that is past its TTL', async () => {
		const db = freshDb();
		await db.apiCache.put({
			key: 't:4',
			cachedAt: Date.now() - 10 * 60_000,
			payload: { n: 'old' }
		});

		const fetcher = stub({ n: 'new' });
		const handle = swr('t:4', fetcher, { ttlMs: 60_000 }, db);

		await vi.waitFor(() => {
			expect(handle.data).toEqual({ n: 'new' });
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
		handle.release();
	});
});

describe('freshness (doc 04 §2)', () => {
	it('reads stale once the TTL has passed', async () => {
		const db = freshDb();
		await db.apiCache.put({ key: 't:5', cachedAt: Date.now() - 90_000, payload: { n: 1 } });

		// Offline, so nothing revalidates and the stale state can be observed.
		online.noteFetchResult('network-error');
		online.noteFetchResult('network-error');

		const handle = swr('t:5', stub({ n: 2 }), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.data).toEqual({ n: 1 });
		});
		expect(handle.status).toBe('stale');
		handle.release();
	});

	it('refuses to render a payload past the hard maximum age', async () => {
		// doc 04 §2: beyond it, do not render cached at all. A week-old forecast
		// is not stale data, it is the wrong data.
		const db = freshDb();
		await db.apiCache.put({
			key: 't:6',
			cachedAt: Date.now() - 8 * 24 * 60 * 60_000,
			payload: { n: 'ancient' }
		});
		online.noteFetchResult('network-error');
		online.noteFetchResult('network-error');

		const handle = swr('t:6', stub({ n: 'new' }), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.cachedAt).toBeDefined();
		});
		expect(handle.data).toBeUndefined();
		expect(handle.status).toBe('idle');
		handle.release();
	});

	it('honours a hardMaxAgeMs the caller sets', async () => {
		const db = freshDb();
		await db.apiCache.put({ key: 't:7', cachedAt: Date.now() - 5000, payload: { n: 1 } });
		online.noteFetchResult('network-error');
		online.noteFetchResult('network-error');

		const handle = swr('t:7', stub({ n: 2 }), { ttlMs: 1000, hardMaxAgeMs: 2000 }, db);
		await vi.waitFor(() => {
			expect(handle.cachedAt).toBeDefined();
		});
		expect(handle.data).toBeUndefined();
		handle.release();
	});

	it('reports an age that grows', async () => {
		const db = freshDb();
		await db.apiCache.put({ key: 't:8', cachedAt: Date.now() - 30_000, payload: { n: 1 } });

		const handle = swr('t:8', stub({ n: 1 }), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.ageMs).toBeGreaterThan(25_000);
		});
		handle.release();
	});
});

describe('failure (doc 17 §4)', () => {
	it('keeps the data it has and flips to stale-error', async () => {
		// doc 04 §2.3: never blank out data that exists.
		const db = freshDb();
		await db.apiCache.put({ key: 'e:1', cachedAt: Date.now() - 90_000, payload: { n: 'kept' } });

		const handle = swr('e:1', failing('UPSTREAM_DOWN'), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('stale-error');
		});
		expect(handle.data).toEqual({ n: 'kept' });
		expect(handle.error).toBe('UPSTREAM_DOWN');
		handle.release();
	});

	it('is a plain error when there is nothing to fall back to', async () => {
		const db = freshDb();
		const handle = swr('e:2', failing('UPSTREAM_DOWN'), { ttlMs: 60_000 }, db);

		await vi.waitFor(() => {
			expect(handle.status).toBe('error');
		});
		expect(handle.data).toBeUndefined();
		handle.release();
	});

	it('maps a network failure to offline rather than to an error', async () => {
		const db = freshDb();
		const handle = swr('e:3', failing('NETWORK'), { ttlMs: 60_000 }, db);

		await vi.waitFor(() => {
			expect(handle.status).toBe('offline');
		});
		handle.release();
	});

	it('maps a 429 to its own status, which the tile shows as stale-error', async () => {
		const db = freshDb();
		const handle = swr('e:4', failing('RATE_LIMITED'), { ttlMs: 60_000 }, db);

		await vi.waitFor(() => {
			expect(handle.status).toBe('rate-limited');
		});
		handle.release();
	});

	it('keeps a BAD_REQUEST an error even with a payload in hand', async () => {
		// The one failure that is this build's fault. Degrading quietly to a
		// stale badge would hide a bug behind an amber dot.
		const db = freshDb();
		await db.apiCache.put({ key: 'e:5', cachedAt: Date.now() - 90_000, payload: { n: 1 } });

		const handle = swr('e:5', failing('BAD_REQUEST'), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('error');
		});
		handle.release();
	});

	it('rejects from revalidate rather than swallowing', async () => {
		// doc 04 §2: backoff belongs to the scheduler, which can only own it if
		// the rejection reaches it.
		const db = freshDb();
		const handle = swr('e:6', failing('UPSTREAM_DOWN'), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('error');
		});

		await expect(handle.revalidate()).rejects.toMatchObject({ code: 'UPSTREAM_DOWN' });
		handle.release();
	});

	it('tells the online store about a network failure and not about others', async () => {
		// doc 17 §3: one module decides what offline means, and swr reports every
		// fetch outcome into it.
		const db = freshDb();
		const network = swr('e:7', failing('NETWORK'), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(network.status).toBe('offline');
		});
		expect(online.streak).toBeGreaterThan(0);
		network.release();

		const upstream = swr('e:8', failing('UPSTREAM_DOWN'), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(upstream.status).toBe('error');
		});
		// An upstream failure is not evidence the link is down.
		expect(online.streak).toBe(0);
		upstream.release();
	});
});

describe('de-duplication (doc 04 §2.5)', () => {
	it('shares one entry and one request between callers of the same key', async () => {
		// Two weather tiles pinned to the same place share a data key and must
		// not fetch twice for one payload (doc 04 §3).
		const db = freshDb();
		const fetcher = stub({ n: 1 });

		const a = swr('d:1', fetcher, { ttlMs: 60_000 }, db);
		const b = swr('d:1', fetcher, { ttlMs: 60_000 }, db);

		await vi.waitFor(() => {
			expect(a.status).toBe('fresh');
		});
		expect(b.data).toEqual({ n: 1 });
		expect(fetcher).toHaveBeenCalledTimes(1);
		expect(swrCache.size).toBe(1);

		a.release();
		b.release();
	});

	it('keeps the entry until the last subscriber releases', async () => {
		const db = freshDb();
		const a = swr('d:2', stub({ n: 1 }), { ttlMs: 60_000 }, db);
		const b = swr('d:2', stub({ n: 1 }), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(a.status).toBe('fresh');
		});

		a.release();
		expect(swrCache.size).toBe(1);
		b.release();
		expect(swrCache.size).toBe(0);
	});

	it('does not grow the map with the deck', async () => {
		// The reason `release()` exists at all.
		const db = freshDb();
		for (let i = 0; i < 20; i++) {
			const handle = swr(`d:many:${String(i)}`, stub({ i }), { ttlMs: 60_000 }, db);
			await vi.waitFor(() => {
				expect(handle.status).toBe('fresh');
			});
			handle.release();
		}
		expect(swrCache.size).toBe(0);
	});

	it('is idempotent, so a double release cannot take another entry down', async () => {
		const db = freshDb();
		const a = swr('d:3', stub({ n: 1 }), { ttlMs: 60_000 }, db);
		const b = swr('d:3', stub({ n: 1 }), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(a.status).toBe('fresh');
		});

		a.release();
		a.release();
		expect(swrCache.size).toBe(1);
		b.release();
		expect(swrCache.size).toBe(0);
	});
});

describe('offline (doc 04 §2.4)', () => {
	it('does not fetch while the app believes it is offline', async () => {
		const db = freshDb();
		await db.apiCache.put({ key: 'o:1', cachedAt: Date.now() - 90_000, payload: { n: 1 } });
		online.noteFetchResult('network-error');
		online.noteFetchResult('network-error');
		expect(online.isOnline).toBe(false);

		const fetcher = stub({ n: 2 });
		const handle = swr('o:1', fetcher, { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.data).toEqual({ n: 1 });
		});
		expect(fetcher).not.toHaveBeenCalled();
		handle.release();
	});
});

describe('the status union (doc 04 §2)', () => {
	it('can produce every status it declares, except the two nothing drives', async () => {
		// A union with a member nothing can reach is a union with a lie in it.
		// `loading` is the exception and is named rather than skipped: it is the
		// frame between a request starting and settling, which a stub fetcher
		// resolves through faster than an assertion can catch — the tile suites
		// cover it, since it is what they render a skeleton for.
		const db = freshDb();
		const seen = new Set<TpSwrStatus>();

		const cases: [string, () => Promise<void>][] = [
			[
				'fresh',
				async () => {
					const h = swr('u:1', stub({ n: 1 }), { ttlMs: 60_000 }, db);
					await vi.waitFor(() => {
						expect(h.status).toBe('fresh');
					});
					seen.add(h.status);
					h.release();
				}
			],
			[
				'stale',
				async () => {
					await db.apiCache.put({ key: 'u:2', cachedAt: Date.now() - 90_000, payload: 1 });
					online.noteFetchResult('network-error');
					online.noteFetchResult('network-error');
					const h = swr('u:2', stub(2), { ttlMs: 60_000 }, db);
					await vi.waitFor(() => {
						expect(h.status).toBe('stale');
					});
					seen.add(h.status);
					h.release();
					online.reset();
					online.init();
				}
			],
			[
				'stale-error',
				async () => {
					await db.apiCache.put({ key: 'u:3', cachedAt: Date.now() - 90_000, payload: 1 });
					const h = swr('u:3', failing('UPSTREAM_DOWN'), { ttlMs: 60_000 }, db);
					await vi.waitFor(() => {
						expect(h.status).toBe('stale-error');
					});
					seen.add(h.status);
					h.release();
				}
			],
			[
				'offline',
				async () => {
					const h = swr('u:4', failing('NETWORK'), { ttlMs: 60_000 }, db);
					await vi.waitFor(() => {
						expect(h.status).toBe('offline');
					});
					seen.add(h.status);
					h.release();
					online.reset();
					online.init();
				}
			],
			[
				'error',
				async () => {
					const h = swr('u:5', failing('BAD_REQUEST'), { ttlMs: 60_000 }, db);
					await vi.waitFor(() => {
						expect(h.status).toBe('error');
					});
					seen.add(h.status);
					h.release();
				}
			],
			[
				'rate-limited',
				async () => {
					const h = swr('u:6', failing('RATE_LIMITED'), { ttlMs: 60_000 }, db);
					await vi.waitFor(() => {
						expect(h.status).toBe('rate-limited');
					});
					seen.add(h.status);
					h.release();
				}
			],
			[
				'idle',
				async () => {
					online.noteFetchResult('network-error');
					online.noteFetchResult('network-error');
					const h = swr('u:7', stub(1), { ttlMs: 60_000 }, db);
					seen.add(h.status);
					h.release();
					online.reset();
					online.init();
				}
			]
		];

		for (const [, drive] of cases) await drive();

		expect([...seen].sort()).toEqual(
			['error', 'fresh', 'idle', 'offline', 'rate-limited', 'stale', 'stale-error'].sort()
		);
	});
});

describe('inspect (doc 13 §10 §8)', () => {
	it('reports a row per key, with its age and status', async () => {
		const db = freshDb();
		const handle = swr('i:1', stub({ n: 1 }), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('fresh');
		});

		const rows = swrCache.inspect();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ key: 'i:1', status: 'fresh', refs: 1, inFlight: false });
		expect(rows[0]?.ageMs).toBeGreaterThanOrEqual(0);
		handle.release();
	});

	it('reports the error code so a reader can see which failure it was', async () => {
		const db = freshDb();
		const handle = swr('i:2', failing('QUOTA_EXHAUSTED'), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('error');
		});

		expect(swrCache.inspect()[0]?.error).toBe('QUOTA_EXHAUSTED');
		handle.release();
	});

	it('is a snapshot, not the live entries', async () => {
		const db = freshDb();
		const handle = swr('i:3', stub({ n: 1 }), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('fresh');
		});

		const before = swrCache.inspect();
		handle.release();
		expect(before).toHaveLength(1);
		expect(swrCache.inspect()).toHaveLength(0);
	});
});

describe('the rate-limit coordinator (doc 17 §5)', () => {
	/**
	 * The claim doc 17 §5 has always made and nothing has ever checked: *one*
	 * global toast per 60 s, however many widgets trip at once. The coordinator
	 * has been here since Week 3 with its answer discarded at the call site, so
	 * until `currency` landed there was no way to observe it and no component to
	 * observe it with.
	 *
	 * The clock is faked rather than waited out — the window is a minute.
	 */
	beforeEach(() => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function trip(key: string, db: TpDb): Promise<void> {
		const handle = swr(key, failing('RATE_LIMITED'), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('rate-limited');
		});
		handle.release();
	}

	it('raises a toast on a 429', async () => {
		const db = freshDb();
		await trip('rl:1', db);

		expect(toasts.current).toBe('rate-limited');
	});

	it('stays silent for a second widget tripping inside the window', async () => {
		// A different key on purpose: the throttle is global, not per-entry, which
		// is the whole point of it living in the module rather than in an entry.
		const db = freshDb();
		await trip('rl:2', db);
		toasts.dismiss();

		await trip('rl:3', db);

		expect(toasts.current).toBeNull();
	});

	it('speaks again once the window has passed', async () => {
		const db = freshDb();
		await trip('rl:4', db);
		toasts.dismiss();

		vi.setSystemTime(Date.now() + BACKOFF.toastThrottleMs + 1);
		await trip('rl:5', db);

		expect(toasts.current).toBe('rate-limited');
	});

	it('says nothing at all for a failure that is not a 429', async () => {
		const db = freshDb();
		const handle = swr('rl:6', failing('UPSTREAM_DOWN'), { ttlMs: 60_000 }, db);
		await vi.waitFor(() => {
			expect(handle.status).toBe('error');
		});
		handle.release();

		expect(toasts.current).toBeNull();
	});
});
