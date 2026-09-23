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

function input(path: string, routeId: string | null, env: Record<string, string>) {
	const resolve = vi.fn(async () => new Response('from the route', { status: 200 }));
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
