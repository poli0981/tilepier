import { describe, expect, it } from 'vitest';
import { klinesUrl, tickerBatchUrl, tickerSymbolUrl } from './binance';

/**
 * doc 10 §4's URLs, and the host they point at.
 *
 * The host assertion pins which endpoint this proxy talks to, so a change of
 * mind about it has to be deliberate. It does **not** assert reachability and
 * cannot: nothing in this suite makes a real request, and the production
 * failure `binance.ts` records is not fixed by either host.
 */
describe('binance urls', () => {
	it('points at the reachable market-data mirror, not the primary', () => {
		for (const url of [
			tickerBatchUrl(['BTCUSDT']),
			tickerSymbolUrl('BTCUSDT'),
			klinesUrl('BTCUSDT', '1d', 500)
		]) {
			expect(url.startsWith('https://data-api.binance.vision/')).toBe(true);
		}
	});

	it('sends a batch as a JSON array, which is what upstream wants', () => {
		// A comma list is accepted by the parameter name and answers for nothing.
		expect(tickerBatchUrl(['BTCUSDT', 'ETHUSDT'])).toContain(
			`symbols=${encodeURIComponent('["BTCUSDT","ETHUSDT"]')}`
		);
	});

	it('sends a single symbol under the singular parameter', () => {
		// `?symbol=` and `?symbols=` answer with different shapes — an object and
		// an array — which is why the split fallback uses this one.
		expect(tickerSymbolUrl('BTCUSDT')).toContain('?symbol=BTCUSDT');
		expect(tickerSymbolUrl('BTCUSDT')).not.toContain('symbols=');
	});

	it('carries the interval and depth on the klines route', () => {
		const url = klinesUrl('BTCUSDT', '5m', 500);

		expect(url).toContain('symbol=BTCUSDT');
		expect(url).toContain('interval=5m');
		expect(url).toContain('limit=500');
	});
});
