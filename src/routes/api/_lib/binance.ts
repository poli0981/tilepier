/**
 * Binance hosts and URLs (doc 10 §4).
 *
 * doc 10 §4 has said since Week 0 that "mirror hosts are a config constant — do
 * not hardcode inline", against the day `api.binance.com` became unreachable
 * from the edge. **2026-09-02 was that day**, and this module is the constant it
 * asked for — one place both crypto routes read, rather than the copy each of
 * them had.
 *
 * ## What was measured
 *
 * Week 5a deployed clean and `/api/fx` answered 200 from production, so the
 * pipeline, the KV binding and the build were all fine. Both crypto routes
 * returned `UPSTREAM_DOWN`. From a developer machine `api.binance.com` answered
 * 200 for the identical URLs — **with and without a `User-Agent`**, which rules
 * out the obvious suspect.
 *
 * The failures were not all the same shape: some requests surfaced as a 4xx
 * that was neither 429 nor 418 (the endpoint turns those into `BAD_REQUEST`,
 * and it did), and the half-open probe after the 120 s cool-down failed as a
 * timeout or a network error instead. Both are consistent with the host
 * refusing traffic from Cloudflare's egress ranges, which is what doc 10 §4
 * anticipated.
 *
 * **What could not be measured from here**, and is worth saying rather than
 * implying: the Worker's own view of the failure. `wrangler tail` and a KV read
 * both need an interactive login, and `/api/_health` — which would print the
 * breaker's `reason` verbatim — is Week 5b. So the diagnosis above is an
 * inference from the outside, and switching the host is the experiment that
 * confirms it.
 *
 * ## The switch did not fix it, and that is the finding (2026-09-02)
 *
 * Both routes still fail on production after this change, in a pattern that
 * pins the cause down harder than the failure itself did: probes 30 s apart
 * returned 400 at attempts 1, 5 and 9 and 503 in between — **exactly every
 * 120 s**, which is `BREAKER.cooldownMs`. So the 503s are the open breaker
 * declining to call upstream at all, and the 400s are the half-open probes
 * reaching it and getting a 4xx that is neither 429 nor 418. Consistently, not
 * intermittently.
 *
 * The remaining explanation that fits every observation is **jurisdiction**.
 * The PoP serving these requests is `SIN`, and Binance does not serve
 * Singapore — a regulatory restriction, answered with 451, and one this mirror
 * inherits because it is Binance's own host. A developer machine on a
 * Vietnamese ISP is not in that jurisdiction, which is why the same URLs answer
 * 200 from here.
 *
 * **If that is right, the failure is per-PoP and therefore per-reader**, which
 * is worse than a clean outage: the widget would work for a reader served from
 * Hanoi and fail for one served from Singapore, with nothing on either screen
 * explaining the difference. It is not something a mirror of the same operator
 * can fix.
 *
 * It is still an inference. `/api/_health` prints the breaker's `reason`, which
 * carries the upstream status verbatim — that is the one measurement that would
 * settle it, and it needs `DEV_DASH_TOKEN` (Week 5b). Until then nothing here
 * should be changed again on a guess; two speculative fixes are one more than
 * this file should carry.
 *
 * ## Why this mirror anyway
 *
 * `data-api.binance.vision` is Binance's own public market-data endpoint. It
 * serves `/api/v3/ticker/24hr` and `/api/v3/klines` with byte-identical shapes
 * (verified against both), carries no account or trading surface at all, and
 * needs no key — so nothing about doc 10 §1's ToS line or doc 16 §5's credit
 * changes. `api1..4.binance.com` are aliases of the same service and would
 * inherit the same restriction; this one exists precisely to be reachable.
 *
 * The primary stays first in the list and unused, rather than deleted: it is
 * the record of what this used to be and what to try again.
 */

/** Not exported: the builders below are the only readers, and knip is
 *  CI-blocking on an export nothing imports. Naming them here is what doc 10 §4
 *  asks for — one place, documented — rather than a value other modules pass
 *  around. */
const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'] as const;

/** The host in use. Index 1 since 2026-09-02 — see above. */
const BINANCE_HOST = BINANCE_HOSTS[1];

/** `?symbols=["A","B"]` — Binance wants a JSON array here, not a comma list. */
export function tickerBatchUrl(symbols: readonly string[]): string {
	return `${BINANCE_HOST}/api/v3/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
}

export function tickerSymbolUrl(symbol: string): string {
	return `${BINANCE_HOST}/api/v3/ticker/24hr?symbol=${encodeURIComponent(symbol)}`;
}

export function klinesUrl(symbol: string, interval: string, limit: number): string {
	const params = new URLSearchParams({ symbol, interval, limit: String(limit) });
	return `${BINANCE_HOST}/api/v3/klines?${params.toString()}`;
}
