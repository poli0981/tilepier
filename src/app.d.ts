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

		/**
		 * Shallow-routing state for the detail overlay (doc 06 §6). Written by
		 * the deck page's `pushState`, read back through `$app/state`, and — the
		 * reason it is typed here rather than inferred — restored verbatim from a
		 * history entry a *previous build* may have written. `isDetailState` in
		 * `core/detail.ts` narrows it before anything trusts it.
		 */
		interface PageState {
			detail?: import('$lib/core/detail').TpDetailState;
		}

		// interface Locals {}
		// interface PageData {}
	}

	/**
	 * `TP_BUILD` from doc 03 §Environment, replaced at build time by the
	 * `define` in vite.config.ts. Declared here or svelte-check fails on every
	 * reference; there is no runtime import to infer it from.
	 */
	const __TP_BUILD__: { version: string; sha: string };
}

export {};
