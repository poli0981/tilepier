import { describe, expect, it } from 'vitest';
import type { TpHealthReport } from '$lib/api-types';
import { STOCK_BUDGET } from '$lib/shared-constants';
import { GET } from './+server';
import { UPSTREAMS } from '../_lib/breaker';
import { DEV_TOKEN_MIN_LENGTH } from '../_lib/dev-token';
import { sanitizeReason } from '../_lib/health';

/**
 * `GET /api/_health` — doc 11 §9.
 *
 * The endpoint's whole job is to be reachable by exactly one reader, so most of
 * this file is about everyone else: no token, a wrong one, the right one sent
 * to a deploy that never set it, and — the case a naive comparison gets wrong —
 * an empty secret met by an empty bearer.
 */

const TOKEN = 'k'.repeat(40);

function fakeKv(): KVNamespace & { store: Map<string, string> } {
	const store = new Map<string, string>();
	return {
		store,
		get: (async (key: string, type?: string) => {
			const raw = store.get(key);
			if (raw == null) return null;
			return type === 'json' ? JSON.parse(raw) : raw;
		}) as KVNamespace['get'],
		put: async (key: string, value: string) => void store.set(key, String(value)),
		delete: async (key: string) => void store.delete(key),
		list: async () => ({ keys: [], list_complete: true }),
		getWithMetadata: async () => ({ value: null, metadata: null, cacheStatus: null })
	} as unknown as KVNamespace & { store: Map<string, string> };
}

interface CallOptions {
	/** Omitted gives a working fake; `null` means the binding is absent. */
	kv?: KVNamespace | null;
	/** What the deploy has set. Omitted means the secret was never put. */
	secret?: string;
	authorization?: string;
	env?: Partial<Env>;
	colo?: string;
}

async function call(options: CallOptions = {}): Promise<Response> {
	const kv = options.kv === undefined ? fakeKv() : (options.kv ?? undefined);
	const url = new URL('https://tilepier.win/api/_health');
	const headers: Record<string, string> = {};
	if (options.authorization !== undefined) headers['authorization'] = options.authorization;

	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			platform?: {
				env: Partial<Env> & { TILEPIER_CACHE: KVNamespace | undefined };
				cf?: { colo?: string };
			};
		}) => Promise<Response>
	)({
		request: new Request(url, { headers }),
		url,
		platform: {
			env: {
				...options.env,
				...(options.secret === undefined ? {} : { DEV_DASH_TOKEN: options.secret }),
				TILEPIER_CACHE: kv
			},
			...(options.colo === undefined ? {} : { cf: { colo: options.colo } })
		}
	});
}

async function report(response: Response): Promise<TpHealthReport> {
	const body = (await response.json()) as { ok: boolean; data: TpHealthReport };
	expect(body.ok).toBe(true);
	return body.data;
}

describe('who gets an answer', () => {
	it('is a 404 with no token at all', async () => {
		const response = await call({ secret: TOKEN });
		expect(response.status).toBe(404);
	});

	it('is a 404 for the wrong token, even one of the right length', async () => {
		const response = await call({ secret: TOKEN, authorization: `Bearer ${'j'.repeat(40)}` });
		expect(response.status).toBe(404);
	});

	it('is a 404 when the deploy never set the secret', async () => {
		const response = await call({ authorization: `Bearer ${TOKEN}` });
		expect(response.status).toBe(404);
	});

	// .dev.vars.example ships `DEV_DASH_TOKEN=` — an empty value is the default
	// state of every checkout, so it must mean "off", not "matches nothing".
	it('is a 404 when an empty secret meets an empty bearer', async () => {
		for (const authorization of ['Bearer ', 'Bearer', '']) {
			const response = await call({ secret: '', authorization });
			expect(response.status, JSON.stringify(authorization)).toBe(404);
		}
	});

	it('is a 404 for a secret too short to be one, even when it matches', async () => {
		const short = 'k'.repeat(DEV_TOKEN_MIN_LENGTH - 1);
		const response = await call({ secret: short, authorization: `Bearer ${short}` });
		expect(response.status).toBe(404);
	});

	it('answers the right bearer', async () => {
		const response = await call({ secret: TOKEN, authorization: `Bearer ${TOKEN}` });
		expect(response.status).toBe(200);
	});

	it('never lets any answer be stored, the refusal included', async () => {
		// The adapter replays a cacheable GET before this handler runs, so a
		// cacheable 200 would reach the next caller without a token.
		const allowed = await call({ secret: TOKEN, authorization: `Bearer ${TOKEN}` });
		const refused = await call({ secret: TOKEN });
		expect(allowed.headers.get('cache-control')).toBe('no-store');
		expect(refused.headers.get('cache-control')).toBe('no-store');
	});

	it('says nothing about itself when refusing', async () => {
		const response = await call({ secret: TOKEN });
		expect(await response.text()).toBe('Not Found');
	});
});

describe('what it reports', () => {
	const authorised = { secret: TOKEN, authorization: `Bearer ${TOKEN}` };

	it('lists every upstream that has a breaker, closed when untouched', async () => {
		const data = await report(await call(authorised));
		expect(data.breakers.map((b) => b.upstream)).toEqual([...UPSTREAMS]);
		expect(data.breakers.every((b) => b.state === 'closed' && b.verdict === 'closed')).toBe(true);
	});

	it('names the location that answered, which is what 5a could not see', async () => {
		expect((await report(await call({ ...authorised, colo: 'SIN' }))).colo).toBe('SIN');
		expect((await report(await call(authorised))).colo).toBeNull();
	});

	it('reports an open breaker with the reason and the verdict the clock gives', async () => {
		const kv = fakeKv();
		kv.store.set(
			'kv:brk:binance',
			JSON.stringify({
				state: 'open',
				openedAt: Date.now() - 10 * 60_000,
				reason: 'upstream 451: {"code":0,"msg":"Service unavailable from a restricted location"}',
				failures: 3
			})
		);

		const data = await report(await call({ ...authorised, kv }));
		const binance = data.breakers.find((b) => b.upstream === 'binance');

		expect(binance?.state).toBe('open');
		// Ten minutes past a 120 s cool-down: the next request would probe.
		expect(binance?.verdict).toBe('half-open');
		expect(binance?.reason).toContain('upstream 451');
		expect(binance?.reason).toContain('restricted location');
	});

	it("reads today's Twelve Data spend against doc 11 §5's tiers", async () => {
		const kv = fakeKv();
		const today = new Date().toISOString().slice(0, 10);
		kv.store.set(`kv:st:budget:${today}`, '123');

		const data = await report(await call({ ...authorised, kv }));
		expect(data.budget).toEqual({
			date: today,
			spent: 123,
			dailyCredits: STOCK_BUDGET.dailyCredits,
			intradayStopAt: STOCK_BUDGET.intradayStopAt,
			dailySeriesStopAt: STOCK_BUDGET.dailySeriesStopAt
		});
	});

	it('says which keys are set and never what they are', async () => {
		const response = await call({
			...authorised,
			env: { FINNHUB_KEY: 'finnhub-secret-value', TWELVEDATA_KEY: '' }
		});
		const text = await response.clone().text();
		const data = await report(response);

		expect(data.keys).toEqual({ finnhub: true, twelvedata: false });
		expect(text).not.toContain('finnhub-secret-value');
		expect(text).not.toContain(TOKEN);
	});

	it('is a 503 in the envelope when the KV binding is absent', async () => {
		const response = await call({ ...authorised, kv: null });
		expect(response.status).toBe(503);
	});
});

describe('sanitizeReason', () => {
	it('masks a credential in a query string', () => {
		expect(sanitizeReason('GET https://x.test/q?symbol=A&apikey=abc123&x=1')).toBe(
			'GET https://x.test/q?symbol=A&apikey=…&x=1'
		);
		expect(sanitizeReason('token=secret')).toBe('token=…');
	});

	it('masks any long key-shaped run', () => {
		expect(sanitizeReason(`echoed ${'a1B2'.repeat(10)} back`)).toBe('echoed … back');
	});

	it('keeps a status and a sentence intact', () => {
		const reason = 'upstream 451: Service unavailable from a restricted location';
		expect(sanitizeReason(reason)).toBe(reason);
	});

	it('bounds the length', () => {
		const out = sanitizeReason('word '.repeat(200));
		expect(out.length).toBe(200);
		expect(out.endsWith('…')).toBe(true);
	});
});
