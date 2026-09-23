import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TpVerifyConfig, TpVerifyPass } from '$lib/api-types';
import { TURNSTILE_ACTION } from '$lib/shared-constants';
import { GET, POST } from './+server';
import { verifyPass } from '../_lib/pass';

/**
 * `/api/verify` (doc 15 §3): whether there is a gate, and a pass for a token.
 * siteverify is stubbed at `fetch`, so every verdict is reachable without
 * Cloudflare.
 */

const SECRET = '0x4AAAAAAA-real-looking-secret';
const SITEKEY = '0x4AAAAAAFAn5Klt4ewHsJOl';
const ORIGIN = 'https://tilepier.win';

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

type Env = {
	TURNSTILE_SECRET_KEY?: string;
	TURNSTILE_SITE_KEY?: string;
	TILEPIER_CACHE?: KVNamespace;
};
type Handler = (event: {
	request: Request;
	url: URL;
	platform?: { env: Env };
}) => Response | Promise<Response>;

const ON = (kv = fakeKv()): Env => ({
	TURNSTILE_SECRET_KEY: SECRET,
	TURNSTILE_SITE_KEY: SITEKEY,
	TILEPIER_CACHE: kv
});

async function get(env: Env): Promise<Response> {
	const url = new URL(`${ORIGIN}/api/verify`);
	return (GET as unknown as Handler)({ request: new Request(url), url, platform: { env } });
}

async function post(
	env: Env,
	body: unknown,
	headers: Record<string, string> = { origin: ORIGIN, 'sec-fetch-site': 'same-origin' }
): Promise<Response> {
	const url = new URL(`${ORIGIN}/api/verify`);
	const request = new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
	return (POST as unknown as Handler)({ request, url, platform: { env } });
}

function siteverifyAnswers(body: unknown, status = 200): void {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json(body, { status }))
	);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('GET', () => {
	it('names the sitekey when the gate is on, and is never stored', async () => {
		const response = await get(ON());
		const body = (await response.json()) as { data: TpVerifyConfig };

		expect(body.data).toEqual({ sitekey: SITEKEY });
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('says there is no gate without the secret — a checkout, CI — even with a sitekey', async () => {
		const body = (await (await get({ TURNSTILE_SITE_KEY: SITEKEY })).json()) as {
			data: TpVerifyConfig;
		};
		expect(body.data).toEqual({ sitekey: null });
	});
});

describe('POST', () => {
	it('trades a real token for an hour-long pass that the gate accepts', async () => {
		siteverifyAnswers({ success: true, action: TURNSTILE_ACTION, hostname: 'tilepier.win' });

		const response = await post(ON(), { token: 'tok' });
		const body = (await response.json()) as { data: TpVerifyPass };

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await verifyPass(SECRET, body.data.pass, Date.now())).toBe(true);
		expect(body.data.expiresAt - Date.now()).toBeGreaterThan(3_500_000);
	});

	it('refuses a token siteverify refused', async () => {
		siteverifyAnswers({ success: false, 'error-codes': ['invalid-input-response'] });
		const response = await post(ON(), { token: 'tok' });

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ ok: false, error: { code: 'VERIFY_REQUIRED' } });
	});

	it('issues a short degraded pass when siteverify is down, and records why', async () => {
		siteverifyAnswers({}, 503);
		const kv = fakeKv();

		const response = await post(ON(kv), { token: 'tok' });
		const body = (await response.json()) as { data: TpVerifyPass };

		expect(response.status).toBe(200);
		expect(body.data.pass.split('.')[3]).toBe('1');
		expect(body.data.expiresAt - Date.now()).toBeLessThanOrEqual(600_000);
		expect(JSON.parse(kv.store.get('kv:brk:turnstile') ?? '{}')).toMatchObject({
			failures: 1,
			reason: 'siteverify 503'
		});
	});

	it('clears the turnstile breaker once siteverify answers again', async () => {
		const kv = fakeKv();
		kv.store.set(
			'kv:brk:turnstile',
			JSON.stringify({ state: 'closed', openedAt: 0, reason: 'siteverify 503', failures: 2 })
		);
		siteverifyAnswers({ success: true, action: TURNSTILE_ACTION, hostname: 'tilepier.win' });

		await post(ON(kv), { token: 'tok' });

		expect(JSON.parse(kv.store.get('kv:brk:turnstile') ?? '{}')).toMatchObject({ failures: 0 });
	});

	it('refuses another origin, and a cross-site fetch', async () => {
		siteverifyAnswers({ success: true, action: TURNSTILE_ACTION, hostname: 'tilepier.win' });

		expect((await post(ON(), { token: 'tok' }, { origin: 'https://evil.test' })).status).toBe(403);
		expect((await post(ON(), { token: 'tok' }, {})).status).toBe(403);
		expect(
			(await post(ON(), { token: 'tok' }, { origin: ORIGIN, 'sec-fetch-site': 'cross-site' }))
				.status
		).toBe(403);
	});

	it('refuses a body that is not a small JSON token', async () => {
		siteverifyAnswers({ success: true, action: TURNSTILE_ACTION, hostname: 'tilepier.win' });

		for (const body of ['not json', {}, { token: '' }, { token: 7 }, { token: 'x'.repeat(2049) }]) {
			expect((await post(ON(), body)).status, JSON.stringify(body).slice(0, 30)).toBe(400);
		}
	});

	it('has nothing to trade when there is no gate', async () => {
		expect((await post({ TURNSTILE_SITE_KEY: SITEKEY }, { token: 'tok' })).status).toBe(400);
	});
});
