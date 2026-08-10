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
}

export {};
