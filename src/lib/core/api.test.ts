import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchEnvelope, isRetryable, TpApiError } from './api';
import { WEATHER_OK, WEATHER_PAYLOAD, WEATHER_STALE } from './__fixtures__/weather';

/**
 * doc 17 §4's error taxonomy, against MSW (doc 19 §1).
 *
 * `setupServer` rather than `setupWorker`: this half of the data layer has no
 * runes and no Dexie, so it runs in the node project and needs no service
 * worker — which is also why doc 15 §6 could keep `msw`'s postinstall denied.
 * The rune and cache half is `swr.svelte.ts`, tested in the browser with plain
 * stub fetchers, so neither suite has to fake what the other one owns.
 */

const BASE = 'https://tilepier.win';
const URL_WEATHER = `${BASE}/api/weather?lat=21.02&lon=105.85`;

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});

function serve(...handlers: Parameters<typeof server.use>) {
	server.use(...handlers);
}

describe('a good response', () => {
	it('unwraps the envelope into data and meta', async () => {
		serve(http.get(`${BASE}/api/weather`, () => HttpResponse.json(WEATHER_OK)));

		const result = await fetchEnvelope<typeof WEATHER_PAYLOAD>(URL_WEATHER);
		expect(result.data.place.timezone).toBe('Asia/Ho_Chi_Minh');
		expect(result.meta.source).toBe('open-meteo');
		expect(result.meta.stale).toBe(false);
	});

	it('carries the stale flag through rather than swallowing it', async () => {
		// doc 11 §4: a 200 with `stale: true` is upstream having failed and the
		// edge serving what it had. The client has to know, or the tile shows an
		// hour-old reading as current.
		serve(http.get(`${BASE}/api/weather`, () => HttpResponse.json(WEATHER_STALE)));

		const result = await fetchEnvelope<typeof WEATHER_PAYLOAD>(URL_WEATHER);
		expect(result.meta.stale).toBe(true);
	});
});

describe('envelope errors (doc 17 §4)', () => {
	for (const [code, status] of [
		['UPSTREAM_DOWN', 503],
		['QUOTA_EXHAUSTED', 503],
		['BAD_REQUEST', 400],
		['RATE_LIMITED', 429]
	] as const) {
		it(`maps ${code} straight through`, async () => {
			serve(
				http.get(`${BASE}/api/weather`, () =>
					HttpResponse.json({ ok: false, error: { code } }, { status })
				)
			);

			await expect(fetchEnvelope(URL_WEATHER)).rejects.toMatchObject({
				name: 'TpApiError',
				code
			});
		});
	}

	it('reads retryAfterS from the envelope', async () => {
		serve(
			http.get(`${BASE}/api/weather`, () =>
				HttpResponse.json(
					{ ok: false, error: { code: 'RATE_LIMITED', retryAfterS: 42 } },
					{ status: 429 }
				)
			)
		);

		await expect(fetchEnvelope(URL_WEATHER)).rejects.toMatchObject({ retryAfterS: 42 });
	});

	it('falls back to the retry-after header when there is no envelope value', async () => {
		// The zone rule (doc 11 §7) blocks before the Worker runs, so its 429 has
		// a header and no body of ours at all.
		serve(
			http.get(`${BASE}/api/weather`, () =>
				HttpResponse.json(
					{ ok: false, error: { code: 'RATE_LIMITED' } },
					{ status: 429, headers: { 'retry-after': '17' } }
				)
			)
		);

		await expect(fetchEnvelope(URL_WEATHER)).rejects.toMatchObject({ retryAfterS: 17 });
	});

	it('prefers the envelope value over the header when both are there', async () => {
		serve(
			http.get(`${BASE}/api/weather`, () =>
				HttpResponse.json(
					{ ok: false, error: { code: 'RATE_LIMITED', retryAfterS: 5 } },
					{ status: 429, headers: { 'retry-after': '99' } }
				)
			)
		);

		await expect(fetchEnvelope(URL_WEATHER)).rejects.toMatchObject({ retryAfterS: 5 });
	});
});

describe('malformed responses', () => {
	it('reports MALFORMED with a body snippet, not a SyntaxError', async () => {
		// The realistic case: an HTML error page from the edge. The snippet is
		// the only thing that says *which* thing returned HTML (doc 17 §4).
		serve(
			http.get(`${BASE}/api/weather`, () =>
				HttpResponse.text('<!doctype html><title>502 Bad Gateway</title>', { status: 502 })
			)
		);

		const error = await fetchEnvelope(URL_WEATHER).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(TpApiError);
		expect((error as TpApiError).code).toBe('MALFORMED');
		expect((error as TpApiError).snippet).toContain('502 Bad Gateway');
	});

	it('caps the snippet at 1 KB so a whole page cannot reach the ring buffer', async () => {
		serve(http.get(`${BASE}/api/weather`, () => HttpResponse.text('x'.repeat(50_000))));

		const error = (await fetchEnvelope(URL_WEATHER).catch((e: unknown) => e)) as TpApiError;
		expect(error.snippet).toHaveLength(1024);
	});

	it('treats a well-formed body with no error code as malformed', async () => {
		// `{ ok: false }` with nothing in it is not a failure this client can
		// classify, and guessing would put a wrong code in diagnostics.
		serve(http.get(`${BASE}/api/weather`, () => HttpResponse.json({ ok: false }, { status: 500 })));

		await expect(fetchEnvelope(URL_WEATHER)).rejects.toMatchObject({ code: 'MALFORMED' });
	});
});

describe('transport failures', () => {
	it('reports a network failure as NETWORK, which is the offline path', async () => {
		serve(http.get(`${BASE}/api/weather`, () => HttpResponse.error()));

		await expect(fetchEnvelope(URL_WEATHER)).rejects.toMatchObject({ code: 'NETWORK' });
	});

	it('re-throws an abort unchanged rather than calling it a network failure', async () => {
		// The caller asked for it. `swr` tells the two apart to decide whether a
		// run counts as a failure at all.
		serve(http.get(`${BASE}/api/weather`, () => HttpResponse.json(WEATHER_OK)));

		const controller = new AbortController();
		controller.abort();

		const error = await fetchEnvelope(URL_WEATHER, controller.signal).catch((e: unknown) => e);
		expect(error).not.toBeInstanceOf(TpApiError);
		expect((error as Error).name).toBe('AbortError');
	});
});

describe('isRetryable', () => {
	it('refuses to retry only the one that cannot succeed', () => {
		// A `BAD_REQUEST` means this build asked for something the endpoint does
		// not accept; the same request fails the same way forever.
		expect(isRetryable('BAD_REQUEST')).toBe(false);
	});

	it('retries everything that passes on its own', () => {
		for (const code of ['NETWORK', 'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'UPSTREAM_DOWN'] as const) {
			expect(isRetryable(code), code).toBe(true);
		}
	});

	it('retries MALFORMED, which is where doc 04 §2 and doc 17 §4 disagreed', () => {
		// Resolved in doc 17 §4's favour: the realistic cause is an HTML error
		// page from the edge, and that clears by itself. doc 04 §2 amended.
		expect(isRetryable('MALFORMED')).toBe(true);
	});
});
