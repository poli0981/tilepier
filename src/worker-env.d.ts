/**
 * The three Worker secrets, declared by hand (doc 11 §9, doc 15 §6).
 *
 * `wrangler types` will not emit them, and that is the whole reason this file
 * exists rather than a `pnpm gen` away. Secrets are not declared in
 * `wrangler.jsonc` — they are set with `wrangler secret put` — so the generator
 * learns their names from `.dev.vars`, which is gitignored. The committed
 * `worker-configuration.d.ts` would therefore differ between a checkout that
 * has a `.dev.vars` and CI, which has none, and `wrangler types --check` inside
 * `pnpm lint` would fail on one of them. Doc 13 §10 recorded that as the reason
 * `/api/_health` was deferred out of Week 3; it blocks every `/api/stock/*`
 * route as well, so it is the first thing Week 5 settles.
 *
 * Declaration merging keeps the generated file untouched. `interface Env` is
 * global there (a `.d.ts` with no top-level import or export), so this adds
 * members to it — the same trick `src/fsa.d.ts` uses on `FileSystemHandle`.
 * `App.Platform.env` is that `Env`, so `platform?.env.FINNHUB_KEY` typechecks
 * everywhere without a cast.
 *
 * Typed `string` rather than `string | undefined`, which is what the generator
 * emits for a secret it can see. The optional chain on `platform?` already
 * makes every read `string | undefined` at the call site, so the "deployed
 * without `wrangler secret put`" branch stays reachable and each endpoint
 * guards it the way it guards a missing KV binding.
 *
 * Keep this file free of any top-level `import`/`export`, or it becomes a
 * module and augments nothing.
 */

interface Env {
	/** Finnhub: `/quote` and `/search` (doc 10 §5). Free tier answers 403 on
	 *  `/stock/candle`, which is why series come from Twelve Data instead. */
	FINNHUB_KEY: string;
	/** Twelve Data: `/time_series`, budgeted at 800 credits/day (doc 11 §5). */
	TWELVEDATA_KEY: string;
	/** Gates `GET /api/_health` (doc 11 §9). Absent from the UI; a reader who
	 *  wants the breaker table passes it in the query string. */
	DEV_DASH_TOKEN: string;
}
