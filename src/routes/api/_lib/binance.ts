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
 * ## Why this mirror
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
