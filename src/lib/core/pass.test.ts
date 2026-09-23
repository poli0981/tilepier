import { describe, expect, it, vi } from 'vitest';
import { PASS_HEADER } from '$lib/shared-constants';
import { PassGate, type TpPassStatus } from './pass';

/**
 * The client's pass (doc 15 §3). The two properties that matter most are the
 * ones a naive version gets wrong: a deck of tiles opening at once costs one
 * challenge, not twelve, and a tile answering late cannot throw away the pass
 * a faster one has just fetched.
 */

interface Server {
	fetcher: ReturnType<typeof vi.fn>;
	calls: { config: number; exchange: number };
}

function server(
	options: { sitekey?: string | null; refuse?: boolean; expiresInMs?: number } = {}
): Server {
	const calls = { config: 0, exchange: 0 };
	let issued = 0;
	const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
		if (init?.method === 'POST') {
			calls.exchange++;
			if (options.refuse === true) {
				return Response.json({ ok: false, error: { code: 'VERIFY_REQUIRED' } }, { status: 401 });
			}
			issued++;
			return Response.json({
				ok: true,
				data: {
					pass: `pass-${String(issued)}`,
					expiresAt: Date.now() + (options.expiresInMs ?? 3_600_000)
				},
				meta: {}
			});
		}
		calls.config++;
		return Response.json({
			ok: true,
			data: { sitekey: options.sitekey === undefined ? 'sitekey' : options.sitekey },
			meta: {}
		});
	});
	return { fetcher, calls };
}

function gate(s: Server): PassGate {
	return new PassGate({ fetcher: s.fetcher as unknown as typeof fetch });
}

describe('PassGate', () => {
	it('sends nothing and fetches nothing until something primes it', async () => {
		const s = server();
		const passes = gate(s);

		expect(await passes.header()).toEqual({});
		expect(s.fetcher).not.toHaveBeenCalled();
	});

	it('answers a whole deck opening at once with one challenge', async () => {
		const s = server();
		const passes = gate(s);
		const challenger = vi.fn(async () => 'token');
		passes.prime(challenger);

		const headers = await Promise.all(Array.from({ length: 12 }, () => passes.header()));

		expect(headers.every((h) => h[PASS_HEADER] === 'pass-1')).toBe(true);
		expect(challenger).toHaveBeenCalledOnce();
		expect(s.calls).toEqual({ config: 1, exchange: 1 });
	});

	it('never challenges when the Worker says there is no gate', async () => {
		const s = server({ sitekey: null });
		const passes = gate(s);
		const challenger = vi.fn(async () => 'token');
		passes.prime(challenger);

		expect(await passes.header()).toEqual({});
		expect(challenger).not.toHaveBeenCalled();
		expect(passes.status).toBe('ready');
	});

	it('re-asks whether there is a gate after a 401 to a request that carried none', async () => {
		const s = server({ sitekey: null });
		const passes = gate(s);
		passes.prime(async () => 'token');
		await passes.header();

		passes.invalidate(undefined);
		await passes.header();

		expect(s.calls.config).toBe(2);
	});

	it('drops only the pass that was refused — never a newer one', async () => {
		const s = server();
		const passes = gate(s);
		passes.prime(async () => 'token');
		await passes.header();

		passes.invalidate('pass-1');
		expect((await passes.header())[PASS_HEADER]).toBe('pass-2');

		// A tile whose request left with pass-1 answers late.
		passes.invalidate('pass-1');
		expect((await passes.header())[PASS_HEADER]).toBe('pass-2');
		expect(s.calls.exchange).toBe(2);
	});

	it('renews a pass inside its last minute rather than sending it', async () => {
		const s = server({ expiresInMs: 30_000 });
		const passes = gate(s);
		passes.prime(async () => 'token');

		await passes.header();
		await passes.header();

		expect(s.calls.exchange).toBe(2);
	});

	it('fails without throwing, reports it, and recovers on retry', async () => {
		const s = server();
		const passes = gate(s);
		let fail = true;
		passes.prime(async () => {
			if (fail) throw new Error('blocked');
			return 'token';
		});

		expect(await passes.header()).toEqual({});
		expect(passes.status).toBe('failed');

		fail = false;
		passes.retry();
		await vi.waitFor(() => expect(passes.status).toBe('ready'));
		expect((await passes.header())[PASS_HEADER]).toBe('pass-1');
	});

	it('treats a refused exchange as a failure too', async () => {
		const passes = gate(server({ refuse: true }));
		passes.prime(async () => 'token');

		expect(await passes.header()).toEqual({});
		expect(passes.status).toBe('failed');
	});

	it('tells a subscriber each change of status', async () => {
		const passes = gate(server());
		const seen: TpPassStatus[] = [];
		passes.subscribe((status) => seen.push(status));

		passes.prime(async () => 'token');
		await passes.header();

		expect(seen).toEqual(['idle', 'checking', 'ready']);
	});
});
