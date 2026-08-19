// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		/** Shaped by `handleError` in hooks.server.ts (doc 17 §1). */
		interface Error {
			/** Correlation id shown on the 500 page so a bug report can cite it. */
			id: string;
			message: string;
		}

		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
	}

	/**
	 * `TP_BUILD` from doc 03 §Environment, replaced at build time by the
	 * `define` in vite.config.ts. Declared here or svelte-check fails on every
	 * reference; there is no runtime import to infer it from.
	 */
	const __TP_BUILD__: { version: string; sha: string };
}

export {};
