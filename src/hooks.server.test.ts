import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server';

/**
 * The hook's half of the gate (doc 15 §3): `/api/*` is guarded before the
 * endpoint runs, and nothing else is. `_lib/gate.test.ts` proves who gets
 * through; this proves the hook asks, and that a refusal never reaches the
 * endpoint at all.
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
	const event = {
		url,
		request: new Request(url),
		route: { id: routeId },
		platform: { env }
	};
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
});

describe('pages', () => {
	const PRELOAD = '<./_app/immutable/assets/1.css>; rel="preload"; as="style"; nopush';

	function page(status: number): () => Response {
		return () =>
			new Response('<!doctype html>', {
				status,
				headers: { 'content-type': 'text/html', link: PRELOAD }
			});
	}

	it('drops the preload hints from a 404, which answers for images and icons too', async () => {
		const { args } = input('/favicon.svg', null, {}, page(404));

		const response = await handle(args);

		expect(response.status).toBe(404);
		expect(response.headers.get('link')).toBeNull();
		expect(response.headers.get('x-content-type-options')).toBe('nosniff');
	});

	it('keeps them on a page that exists', async () => {
		const { args } = input('/settings', '/(app)/settings', {}, page(200));

		expect((await handle(args)).headers.get('link')).toBe(PRELOAD);
	});
});
