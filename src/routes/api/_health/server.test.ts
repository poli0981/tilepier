import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TpHealthReport } from '$lib/api-types';
import { STOCK_BUDGET } from '$lib/shared-constants';
import { GET } from './+server';
import { UPSTREAMS } from '../_lib/breaker';
import { DEV_TOKEN_MIN_LENGTH } from '../_lib/dev-token';
import { sanitizeReason } from '../_lib/health';
import { CRYPTO_PROBES, probeCrypto, type TpProbeReport } from '../_lib/probe';

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
	env?: Partial<
		Pick<Env, 'FINNHUB_KEY' | 'TWELVEDATA_KEY' | 'TURNSTILE_SECRET_KEY' | 'TURNSTILE_SITE_KEY'>
	>;
	colo?: string;
	/** The query string, `?` included. */
	search?: string;
}

async function call(options: CallOptions = {}): Promise<Response> {
	const kv = options.kv === undefined ? fakeKv() : (options.kv ?? undefined);
	const url = new URL(`https://tilepier.win/api/_health${options.search ?? ''}`);
	const headers: Record<string, string> = {};
	if (options.authorization !== undefined) headers['authorization'] = options.authorization;

	return (
		GET as unknown as (event: {
			request: Request;
			url: URL;
			platform?: {
				env: Partial<
					Pick<
						Env,
						| 'FINNHUB_KEY'
						| 'TWELVEDATA_KEY'
						| 'DEV_DASH_TOKEN'
						| 'TURNSTILE_SECRET_KEY'
						| 'TURNSTILE_SITE_KEY'
					>
				> & {
					TILEPIER_CACHE: KVNamespace | undefined;
				};
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

		expect(data.keys).toEqual({ finnhub: true, twelvedata: false, turnstile: false });
		expect(data.gate).toBe('off');
		expect(text).not.toContain('finnhub-secret-value');
		expect(text).not.toContain(TOKEN);
	});

	// A secret put without its sitekey would have every networked tile refused;
	// the report is where an operator finds out which half is missing.
	it('reports the gate as on, or as misconfigured when a half is missing', async () => {
		const both = { TURNSTILE_SECRET_KEY: 's', TURNSTILE_SITE_KEY: 'k' };
		expect((await report(await call({ ...authorised, env: both }))).gate).toBe('on');
		expect(
			(await report(await call({ ...authorised, env: { TURNSTILE_SECRET_KEY: 's' } }))).gate
		).toBe('misconfigured');
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

/**
 * `?probe=crypto` (doc 10 §4): which crypto upstream answers this Worker. The
 * cases that matter are the ones about *not* being a way out: only the
 * operator can trigger it, the parameter names a report rather than a target,
 * and every probe is a fixed keyless URL.
 */
describe('the crypto probe', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	/** Binance's WAF page, one candidate that answers, and a network that fails. */
	function stubUpstreams(): string[] {
		const asked: string[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (input: RequestInfo | URL) => {
				const url = new URL(String(input));
				asked.push(url.href);
				if (url.host === 'data-api.binance.vision') {
					return new Response(
						'<html> <head><title>403 Forbidden</title></head> <body></body> </html>',
						{ status: 403 }
					);
				}
				if (url.host === 'api.kraken.com') {
					return Response.json({ error: [], result: { XBTUSDT: { c: ['62910.5', '1'] } } });
				}
				throw new TypeError('network down');
			})
		);
		return asked;
	}

	it('answers only the operator, like the report it shares a door with', async () => {
		const asked = stubUpstreams();

		const response = await call({ secret: TOKEN, search: '?probe=crypto' });

		expect(response.status).toBe(404);
		expect(asked).toEqual([]);
	});

	it('asks every candidate from where it runs, and says what each answered', async () => {
		stubUpstreams();

		const response = await call({
			secret: TOKEN,
			authorization: `Bearer ${TOKEN}`,
			search: '?probe=crypto',
			colo: 'SJC'
		});
		const body = (await response.json()) as { data: TpProbeReport };

		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(body.data.colo).toBe('SJC');
		expect(body.data.results).toHaveLength(CRYPTO_PROBES.length);

		const binance = body.data.results.find((r) => r.name === 'binance' && r.kind === 'ticker');
		expect(binance?.status).toBe(403);
		expect(binance?.snippet).toContain('403 Forbidden');
		expect(body.data.results.find((r) => r.name === 'kraken')?.status).toBe(200);
		expect(body.data.results.find((r) => r.name === 'okx')).toMatchObject({
			status: null,
			snippet: 'network down'
		});
	});

	it('reads the parameter as a report name, never as a target', async () => {
		const asked = stubUpstreams();

		const response = await call({
			secret: TOKEN,
			authorization: `Bearer ${TOKEN}`,
			search: '?probe=https://example.com/'
		});

		// The ordinary report, and nothing fetched on the caller's say-so.
		expect((await report(response)).breakers).toHaveLength(UPSTREAMS.length);
		expect(asked).toEqual([]);
	});

	it('reports a candidate that never answers instead of waiting on it', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_input: RequestInfo | URL, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
					})
			)
		);

		const { results } = await probeCrypto('SIN', 20, [
			{ name: 'slow', kind: 'ticker', url: 'https://slow.example/ticker' }
		]);

		expect(results[0]).toMatchObject({ status: null, snippet: 'no answer in 20 ms' });
	});

	it('probes only fixed https URLs that carry no credential', () => {
		for (const target of CRYPTO_PROBES) {
			const url = new URL(target.url);
			expect(url.protocol, target.url).toBe('https:');
			expect(url.search, target.url).not.toMatch(/key|token|secret|signature/i);
			expect(target.headers?.['authorization'], target.url).toBeUndefined();
		}
	});
});
