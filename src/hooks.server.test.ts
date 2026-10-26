import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle, handleError } from './hooks.server';
import { bind, settle } from './routes/api/_lib/__fixtures__/workers';

/**
 * The hook's half of the gate (doc 15 §3): `/api/*` is guarded before the
 * endpoint runs, and nothing else is. `_lib/gate.test.ts` proves who gets
 * through; this proves the hook asks, and that a refusal never reaches the
 * endpoint at all. The edge cache sits in front of both (`_lib/edge-cache.ts`),
 * where adapter-cloudflare's worker kept it until version 8.
 */

const ON = { TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: 'sitekey' };

type HandleInput = Parameters<typeof handle>[0];

function input(
	path: string,
	routeId: string | null,
	env: Record<string, string>,
	answer: () => Response = () => new Response('from the route', { status: 200 })
) {
	const resolve = vi.fn(async () => answer());
	const url = new URL(`https://tilepier.win${path}`);
	bind(env);
	const event = { url, request: new Request(url), route: { id: routeId } };
	return { resolve, args: { event, resolve } as unknown as HandleInput };
}

describe('handle', () => {
	it('refuses an unverified /api request without ever calling the endpoint', async () => {
		const { resolve, args } = input('/api/fx', '/api/fx', ON);

		const response = await handle(args);

		expect(response.status).toBe(401);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('lets pages through untouched, gate or no gate', async () => {
		const { resolve, args } = input('/settings', '/(app)/settings', ON);

		expect((await handle(args)).status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('lets the exempt routes reach their handlers', async () => {
		const { resolve, args } = input('/api/verify', '/api/verify', ON);

		expect((await handle(args)).status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('is a no-op for /api when there is no gate', async () => {
		const { resolve, args } = input('/api/fx', '/api/fx', {});

		expect((await handle(args)).status).toBe(200);
		expect(resolve).toHaveBeenCalledOnce();
	});

	it('gives HTML the security headers, and leaves JSON alone', async () => {
		const html = input(
			'/settings',
			'/(app)/settings',
			{},
			() => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } })
		);
		const json = input('/api/fx', '/api/fx', {}, () => Response.json({ ok: true }));

		expect((await handle(html.args)).headers.get('x-content-type-options')).toBe('nosniff');
		expect((await handle(json.args)).headers.get('x-content-type-options')).toBeNull();
	});
});

describe('the edge cache', () => {
	/** `caches.default` as far as the hook uses it, keyed by URL. */
	function edge(): Map<string, Response> {
		const entries = new Map<string, Response>();
		vi.stubGlobal('caches', {
			default: {
				match: async (request: Request) => entries.get(request.url)?.clone(),
				put: async (request: Request, response: Response) => void entries.set(request.url, response)
			}
		});
		return entries;
	}

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('answers a stored /api request before the gate asks for a pass', async () => {
		const entries = edge();
		entries.set(
			'https://tilepier.win/api/fx',
			Response.json({ ok: true }, { headers: { 'cache-control': 'public, max-age=60' } })
		);
		const { resolve, args } = input('/api/fx', '/api/fx', ON);

		const response = await handle(args);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(resolve).not.toHaveBeenCalled();
	});

	it('keeps what an endpoint answers for the next request', async () => {
		const entries = edge();
		const { args } = input('/api/fx', '/api/fx', {}, () =>
			Response.json({ ok: true }, { headers: { 'cache-control': 'public, max-age=60' } })
		);

		await handle(args);
		await settle();

		expect(entries.has('https://tilepier.win/api/fx')).toBe(true);
	});

	it('never keeps the refusal, nor anything a page answers', async () => {
		const entries = edge();
		const refused = input('/api/fx', '/api/fx', ON);
		expect((await handle(refused.args)).status).toBe(401);

		const page = input(
			'/settings',
			'/(app)/settings',
			{},
			() =>
				new Response('<!doctype html>', {
					headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' }
				})
		);
		await handle(page.args);
		await settle();

		expect(entries.size).toBe(0);
	});
});

describe('handleError', () => {
	type Caught = Parameters<typeof handleError>[0];

	function caught(error: Omit<Caught, 'event'>): Caught {
		return { ...error, event: {} } as Caught;
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('keeps the message of an error thrown on purpose, and logs nothing', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		const answer = await handleError(caught({ kind: 'app', error: { id: '', message: 'gone' } }));

		expect(answer).toEqual({ id: expect.any(String) });
		expect(log).not.toHaveBeenCalled();
	});

	it('treats what SvelteKit refuses below 500 as the request’s doing', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

		for (const status of [404, 405]) {
			const error = { status, message: 'refused' };
			expect(await handleError(caught({ kind: 'framework', error }))).toEqual({
				id: expect.any(String)
			});
		}
		expect(log).not.toHaveBeenCalled();
	});

	it('logs a fault under the id the reader sees, and tells them nothing more', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const fault = new Error('KV said no: token=abc');

		const answer = await handleError(caught({ kind: 'unknown', error: fault }));

		expect(answer).toEqual({ id: expect.any(String), message: 'unexpected error' });
		expect(log).toHaveBeenCalledWith(`[${(answer as { id: string }).id}]`, fault);
	});
});
