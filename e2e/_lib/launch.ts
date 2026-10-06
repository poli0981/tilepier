/**
 * The Chromium arguments every spec launches with (`playwright.config.ts`).
 *
 * A module of its own because `test.use({ launchOptions })` *replaces* the
 * config's launch options rather than merging into them. A spec that changes
 * one of them — `e2e/scrollbars` drops `--hide-scrollbars` — has to restate
 * these, or it silently loses the certificate flag the service worker needs and
 * the host rules that keep the suite hermetic.
 *
 * `ignoreHTTPSErrors` covers page and API requests but NOT the fetch of a
 * service worker script: Chromium enforces certificate validity there
 * regardless, and registration fails with "An SSL certificate error occurred
 * when fetching the script" — silently, since nothing rejects. The browser flag
 * is the only way to test a service worker against wrangler's self-signed local
 * cert. Local test rig only; production serves a real certificate.
 *
 * The host rules keep the suite hermetic (doc 19 §4). Every page carries the
 * Cloudflare Web Analytics beacon, and the bot check can load Turnstile;
 * neither may reach the network from a test run — CI would report page views
 * into production's analytics and depend on Cloudflare being up. Unresolvable
 * hosts fail fast, and the CSP check still runs, because a violation is raised
 * before any fetch.
 *
 * OpenFreeMap joined them with the map (Week 6 spike M0): a map spec that forgot
 * its fixture would otherwise fetch real tiles. A spec that wants tiles serves
 * them with `page.route`, which answers before DNS — and which sees the
 * requests MapLibre makes from its worker, measured in M0 (doc 22 §S6).
 */
export const LAUNCH_ARGS: string[] = [
	'--ignore-certificate-errors',
	'--host-resolver-rules=MAP static.cloudflareinsights.com ~NOTFOUND, MAP cloudflareinsights.com ~NOTFOUND, MAP challenges.cloudflare.com ~NOTFOUND, MAP tiles.openfreemap.org ~NOTFOUND'
];
