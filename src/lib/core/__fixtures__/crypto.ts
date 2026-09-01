import type { TpApiResponse, TpCryptoTickerPayload } from '$lib/api-types';

/**
 * A recorded, trimmed `/api/crypto/ticker` envelope (doc 19 §1).
 *
 * Recorded against Binance's `/api/v3/ticker/24hr` shape on 2026-09-01 and run
 * through `normalizeCryptoTicker`, so what is written here is the *normalised*
 * payload rather than upstream's — the raw string-encoded rows live in
 * `routes/api/_lib/crypto-normalize.test.ts`, which is where the parsing is
 * asserted. A fixture that carried both would let the two drift.
 *
 * Three rows, chosen so the tile's three renderings are all reachable from one
 * fixture:
 *
 * - **`BTCUSDT`** — an ordinary row, above a dollar, so doc 09 §1's two-decimal
 *   rule applies and the change chip is positive.
 * - **`DOGEUSDT`** — sub-dollar and *falling*, which is the only row that
 *   exercises the four-decimal branch of `priceDigits` and the down colour
 *   together. Colour is never the only channel (doc 12 §4.2), so the sign has
 *   to be there as well.
 * - **`GONEUSDT`** — `null`, which is doc 09 §1's delisted case. Nothing else
 *   in the suite produces a per-row absence, and it is the shape the endpoint's
 *   per-symbol split exists to make.
 */

export const CRYPTO_PAYLOAD: TpCryptoTickerPayload = {
	quotes: {
		BTCUSDT: {
			symbol: 'BTCUSDT',
			price: 62_910.53,
			change24h: 0.021_26,
			high24h: 63_200,
			low24h: 61_200.45,
			volume24h: 18_422.19,
			at: 1_788_220_799_999
		},
		DOGEUSDT: {
			symbol: 'DOGEUSDT',
			price: 0.2143,
			change24h: -0.0154,
			high24h: 0.2231,
			low24h: 0.2098,
			volume24h: 1_204_881_002.4,
			at: 1_788_220_799_999
		},
		GONEUSDT: null
	},
	attribution: 'Crypto data by Binance'
};

const META = { cachedAt: 1_788_220_800, source: 'binance', stale: false };

export const CRYPTO_OK: TpApiResponse<TpCryptoTickerPayload> = {
	ok: true,
	data: CRYPTO_PAYLOAD,
	meta: META
};

/**
 * The same payload, served past its KV TTL because upstream was down (doc 11
 * §4).
 *
 * `swr` computes staleness from the *client's* cache age alone, so this arrives
 * with a fresh `cachedAt` and would read as `fresh` — the tile has to treat
 * `meta.stale` as staleness alongside the status, which is what doc 04 §2's
 * "what the first consumer settled" requires of every networked widget.
 */
export const CRYPTO_STALE: TpApiResponse<TpCryptoTickerPayload> = {
	ok: true,
	data: CRYPTO_PAYLOAD,
	meta: { ...META, stale: true }
};
