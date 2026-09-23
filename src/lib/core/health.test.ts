import { describe, expect, it, vi } from 'vitest';
import type { TpHealthReport } from '$lib/api-types';
import { fetchHealth } from './health';

/**
 * The panel half of `/api/_health`. The server half proves who may read it;
 * this proves the token goes where it should and only there.
 */

const REPORT: TpHealthReport = {
	now: 1_790_000_000_000,
	colo: 'SIN',
	build: { version: '0.0.0', sha: 'abc1234' },
	breakers: [],
	budget: {
		date: '2026-09-23',
		spent: 0,
		dailyCredits: 800,
		intradayStopAt: 720,
		dailySeriesStopAt: 780
	},
	keys: { finnhub: false, twelvedata: false }
};

function stub(response: Response | Error) {
	return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
		if (response instanceof Error) throw response;
		return response;
	});
}

describe('fetchHealth', () => {
	it('sends the token as a bearer header and never in the URL', async () => {
		const fetcher = stub(Response.json({ ok: true, data: REPORT, meta: {} }));

		await fetchHealth('the-operator-token', fetcher);

		const [url, init] = fetcher.mock.calls[0] ?? [];
		expect(String(url)).toBe('/api/_health');
		expect(String(url)).not.toContain('the-operator-token');
		expect(new Headers(init?.headers).get('authorization')).toBe('Bearer the-operator-token');
		expect(init?.cache).toBe('no-store');
	});

	it('hands back the report', async () => {
		const result = await fetchHealth(
			't',
			stub(Response.json({ ok: true, data: REPORT, meta: {} }))
		);
		expect(result).toEqual({ kind: 'ok', report: REPORT });
	});

	it('reads a 404 as a refusal, not a failure', async () => {
		const result = await fetchHealth('t', stub(new Response('Not Found', { status: 404 })));
		expect(result).toEqual({ kind: 'refused' });
	});

	it('reads offline, an error envelope, and a non-JSON body as failures', async () => {
		expect(await fetchHealth('t', stub(new TypeError('offline')))).toEqual({ kind: 'failed' });
		expect(
			await fetchHealth(
				't',
				stub(Response.json({ ok: false, error: { code: 'UPSTREAM_DOWN' } }, { status: 503 }))
			)
		).toEqual({ kind: 'failed' });
		expect(await fetchHealth('t', stub(new Response('<html>', { status: 502 })))).toEqual({
			kind: 'failed'
		});
	});
});
