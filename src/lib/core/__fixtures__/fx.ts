import type { TpApiResponse, TpFxPayload } from '$lib/api-types';

/**
 * A recorded, trimmed `/api/fx` envelope (doc 19 §1).
 *
 * Recorded from open.er-api.com on 2026-08-31, the same way the weather and
 * geocode fixtures were, and for a sharper reason than habit: **nothing in this
 * repo had ever seen an ER-API response.** doc 10 §3 named the URL and
 * `time_next_update_unix` and nothing else, and the open endpoint's field is
 * `rates` where the keyed v6 API's is `conversion_rates` — a difference that
 * typechecks perfectly and returns an empty table forever.
 *
 * Trimmed from 166 currencies to ten. The rates are real, unrounded, and
 * deliberately unpretty: VND at five decimal places is what makes doc 08 §2's
 * "display rounding per currency minor units" a rule with something to do.
 *
 * **`ZWL` is in `prevRates` and not in `rates`, and that is the point of it.**
 * doc 08 §2's edge case is a currency upstream dropped between two days, which
 * a reader can still have sitting in their saved settings — the row stays and
 * is marked unavailable rather than vanishing or rendering `NaN`. Nothing else
 * in the suite produces that shape.
 */

export const FX_PAYLOAD: TpFxPayload = {
	base: 'USD',
	rates: {
		USD: 1,
		VND: 26006.374497,
		EUR: 0.862295,
		GBP: 0.738249,
		JPY: 160.045067,
		THB: 33.110487,
		SGD: 1.273831,
		AUD: 1.395915,
		KRW: 1376.596684,
		CNY: 6.735761
	},
	// 2026-08-31T00:02:31Z, upstream's own stamp rather than ours.
	asOf: 1_788_134_551_000,
	// 2026-09-01T00:10:21Z — a shade over 24 h out, which is why doc 10 §3's
	// `min(12 h, next-update + 5 min)` almost always resolves to the 12 h in
	// doc 11 §4's row and only bites in the last half-day before a publication.
	nextUpdateAt: 1_788_221_421_000,
	prevRates: {
		USD: 1,
		VND: 25_951.2,
		EUR: 0.8657,
		GBP: 0.7401,
		JPY: 159.12,
		THB: 33.42,
		SGD: 1.2769,
		AUD: 1.4012,
		KRW: 1381.4,
		CNY: 6.7502,
		ZWL: 26.4987
	},
	prevDate: '2026-08-30',
	attribution: 'Rates By Exchange Rate API'
};

/**
 * Day one, and the only shape the app can produce on the day it deploys.
 *
 * The snapshot pile starts empty, so there is no yesterday to compare against
 * and doc 08 §2’s 24 h change is **absent** rather than zero. Worth a fixture
 * of its own because it is the state every first reviewer sees and no other
 * test would otherwise reach.
 */
export const FX_PAYLOAD_DAY_ONE: TpFxPayload = {
	...FX_PAYLOAD,
	prevRates: null,
	prevDate: null
};

export const FX_OK: TpApiResponse<TpFxPayload> = {
	ok: true,
	data: FX_PAYLOAD,
	meta: { cachedAt: 1_788_134_551, source: 'er-api', stale: false }
};

/** doc 11 §4: served past the TTL because upstream failed. */
export const FX_STALE: TpApiResponse<TpFxPayload> = {
	ok: true,
	data: FX_PAYLOAD,
	meta: { cachedAt: 1_788_040_000, source: 'er-api', stale: true }
};

/**
 * The upstream body, not our envelope — what `normalizeFx` actually parses.
 *
 * Kept beside the normalized form so the two can be asserted against each
 * other, and carrying the fields the endpoint reads plus the ones it ignores,
 * because "upstream sends more than we use" is itself part of the shape.
 */
export const ER_API_BODY = {
	result: 'success',
	provider: 'https://www.exchangerate-api.com',
	documentation: 'https://www.exchangerate-api.com/docs/free',
	terms_of_use: 'https://www.exchangerate-api.com/terms',
	time_last_update_unix: 1_788_134_551,
	time_last_update_utc: 'Mon, 31 Aug 2026 00:02:31 +0000',
	time_next_update_unix: 1_788_221_421,
	time_next_update_utc: 'Tue, 01 Sep 2026 00:10:21 +0000',
	time_eol_unix: 0,
	base_code: 'USD',
	rates: FX_PAYLOAD.rates
};
