/**
 * `cloudflare:workers` for the server tests, which run in Node, where the
 * Workers runtime's own module does not exist: the `server` project in
 * vite.config.ts points the import here.
 *
 * Since adapter-cloudflare 8 an endpoint takes its bindings and `waitUntil`
 * from that module rather than from `event.platform`, so a test sets the first
 * with `bind` before calling one, and awaits the second with `settle` after.
 */

type Bindings = { -readonly [K in keyof Env]?: Env[K] | undefined };

/** What an endpoint reads as `env`. Replaced whole by `bind`. */
export const env: Bindings = {};

const pending: Promise<unknown>[] = [];

export function waitUntil(promise: Promise<unknown>): void {
	pending.push(promise);
}

/**
 * The bindings for the next call, and nothing a previous test left: an absent
 * binding is a missing key or `undefined`. Forgets whatever earlier calls
 * handed to `waitUntil`, as a fresh request would.
 */
export function bind(bindings: Bindings): void {
	for (const key of Object.keys(env)) delete env[key as keyof Bindings];
	Object.assign(env, bindings);
	pending.length = 0;
}

/** Resolves once everything handed to `waitUntil` since the last `bind` has
 *  settled. */
export function settle(): Promise<unknown> {
	return Promise.all(pending.splice(0));
}
