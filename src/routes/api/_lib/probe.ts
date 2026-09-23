/**
 * The crypto upstream probe behind `GET /api/_health?probe=crypto` (doc 10 §4).
 *
 * Binance refuses this Worker at its WAF from every PoP measured (a bare HTML
 * 403 from `SJC` and `SIN`, 2026-09-23), so `markets` needs a different crypto
 * upstream — and the only place that can say which one answers is the Worker
 * itself. A developer machine is the wrong vantage point by construction: that
 * is exactly where Binance answered 200 all along.
 *
 * **Fixed URLs, nothing caller-supplied.** The probe cannot be pointed
 * anywhere; it asks each candidate for the two things `markets` needs of an
 * upstream — a BTC ticker with 24 h stats and five-minute candles — and reports
 * what came back. Keyless endpoints only, so nothing here spends a quota or
 * carries a secret, and the route in front of it answers only the operator.
 *
 * **Headers as production sends them.** Every upstream call in this Worker goes
 * out with `accept-encoding: gzip` and no `User-Agent` (`upstream.ts`), so the
 * probe does the same — plus one Binance row that does send a `User-Agent`,
 * which is the one variable a WAF could plausibly key on that the developer
 * machine measurement (with and without one) could not rule out from here.
 */

interface TpProbeTarget {
	name: string;
	kind: 'ticker' | 'candles';
	url: string;
	headers?: Record<string, string>;
}

const UA = { 'user-agent': 'TilePier/1.0 (tilepier.win)' };

export const CRYPTO_PROBES: readonly TpProbeTarget[] = [
	// The control: the host `markets` used until 2026-09-23, refused at its WAF.
	{
		name: 'binance',
		kind: 'ticker',
		url: 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT'
	},
	{
		name: 'binance',
		kind: 'candles',
		url: 'https://data-api.binance.vision/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=2'
	},
	{
		name: 'binance+ua',
		kind: 'ticker',
		url: 'https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT',
		headers: UA
	},
	// The host `markets` uses since 2026-09-23 (`_lib/binance.ts`).
	{
		name: 'binance-us',
		kind: 'ticker',
		url: 'https://api.binance.us/api/v3/ticker/24hr?symbol=BTCUSDT'
	},
	{
		name: 'binance-us',
		kind: 'candles',
		url: 'https://api.binance.us/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=2'
	},
	{
		name: 'coinbase',
		kind: 'ticker',
		url: 'https://api.exchange.coinbase.com/products/BTC-USDT/stats'
	},
	{
		name: 'coinbase',
		kind: 'candles',
		url: 'https://api.exchange.coinbase.com/products/BTC-USDT/candles?granularity=300'
	},
	{ name: 'kraken', kind: 'ticker', url: 'https://api.kraken.com/0/public/Ticker?pair=XBTUSDT' },
	{
		name: 'kraken',
		kind: 'candles',
		url: 'https://api.kraken.com/0/public/OHLC?pair=XBTUSDT&interval=5'
	},
	{
		name: 'okx',
		kind: 'ticker',
		url: 'https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT'
	},
	{
		name: 'okx',
		kind: 'candles',
		url: 'https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=5m&limit=2'
	},
	{
		name: 'bybit',
		kind: 'ticker',
		url: 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT'
	},
	{
		name: 'kucoin',
		kind: 'ticker',
		url: 'https://api.kucoin.com/api/v1/market/stats?symbol=BTC-USDT'
	},
	{
		name: 'bitstamp',
		kind: 'ticker',
		url: 'https://www.bitstamp.net/api/v2/ticker/btcusdt/'
	},
	{
		name: 'coingecko',
		kind: 'ticker',
		url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true'
	}
];

interface TpProbeResult {
	name: string;
	kind: 'ticker' | 'candles';
	host: string;
	/** `null` when no response arrived at all. */
	status: number | null;
	ms: number;
	/** The first characters of the body, whitespace collapsed; or why there was none. */
	snippet: string;
}

export interface TpProbeReport {
	/** The Cloudflare location the probe ran from — the whole point of it. */
	colo: string | null;
	results: TpProbeResult[];
}

/** Enough of a body to tell JSON from a WAF page, and no more. */
const SNIPPET = 160;
const READ_CAP = 4096;

async function head(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return '';
	const decoder = new TextDecoder();
	let text = '';
	try {
		while (text.length < READ_CAP) {
			const { done, value } = await reader.read();
			if (done) break;
			text += decoder.decode(value, { stream: true });
		}
	} finally {
		// A candles body can be tens of kilobytes; the probe needs its first line.
		await reader.cancel().catch(() => undefined);
	}
	return text.replace(/\s+/g, ' ').trim().slice(0, SNIPPET);
}

async function probeOne(target: TpProbeTarget, timeoutMs: number): Promise<TpProbeResult> {
	const started = Date.now();
	const base = { name: target.name, kind: target.kind, host: new URL(target.url).host };
	try {
		const response = await fetch(target.url, {
			headers: { 'accept-encoding': 'gzip', ...target.headers },
			signal: AbortSignal.timeout(timeoutMs)
		});
		const snippet = await head(response);
		return { ...base, status: response.status, ms: Date.now() - started, snippet };
	} catch (error) {
		const reason =
			error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
				? `no answer in ${String(timeoutMs)} ms`
				: error instanceof Error
					? error.message
					: String(error);
		return { ...base, status: null, ms: Date.now() - started, snippet: reason.slice(0, SNIPPET) };
	}
}

/** Every candidate at once: the report takes as long as the slowest, capped. */
export async function probeCrypto(
	colo: string | null,
	timeoutMs = 5000,
	targets: readonly TpProbeTarget[] = CRYPTO_PROBES
): Promise<TpProbeReport> {
	return { colo, results: await Promise.all(targets.map((t) => probeOne(t, timeoutMs))) };
}
