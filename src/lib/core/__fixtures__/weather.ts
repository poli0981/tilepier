import type { TpApiResponse, TpWeatherPayload } from '$lib/api-types';

/**
 * A recorded, trimmed `/api/weather` envelope (doc 19 §1).
 *
 * Trimmed hard on purpose: the real Open-Meteo response carries 168 hourly
 * values across nine variables, and a fixture that large tests the JSON parser
 * rather than the code under test. Four hours and two days is enough to prove
 * the shape survives the round trip, and it stays readable in a diff.
 *
 * The envelope itself is verbatim from doc 11 §2, and the payload is the
 * **normalized** `TpWeatherPayload` rather than Open-Meteo's columnar shape —
 * which is what the endpoint has produced since 2026-08-28, and what doc 10 §2
 * required all along. `_lib/normalize.test.ts` covers the mapping itself; this
 * fixture is what a *client* sees.
 *
 * **The fourth hour is a gap, and it is spelled `null`.** That is the whole
 * reason it is here. `normalize.ts` marks a missing column with `NaN`, but the
 * payload crosses `JSON.stringify` in `_lib/respond.ts` on the way out and
 * `JSON.stringify(NaN)` is `null`. No test in the repo crossed that boundary
 * before Week 4, so `Number.isNaN` guards read as correct and would have let
 * every real gap straight through to a `.toFixed()` on `null`.
 */

export const WEATHER_PAYLOAD: TpWeatherPayload = {
	place: { lat: 21.02, lon: 105.85, timezone: 'Asia/Ho_Chi_Minh' },
	hourly: [
		{
			t: '2026-08-28T09:00',
			tempC: 31.4,
			precipProb: 10,
			precipMm: 0,
			code: 2,
			windKph: 11,
			windDeg: 120,
			humidity: 70,
			uv: 7.2,
			pressureHpa: 1006,
			cloudPct: 40
		},
		{
			t: '2026-08-28T10:00',
			tempC: 32.8,
			precipProb: 15,
			precipMm: 0.2,
			code: 3,
			windKph: 14,
			windDeg: 130,
			humidity: 66,
			uv: 8.1,
			pressureHpa: 1005,
			cloudPct: 65
		},
		{
			t: '2026-08-28T11:00',
			tempC: 33.9,
			precipProb: 25,
			precipMm: 0.4,
			code: 61,
			windKph: 16,
			windDeg: 140,
			humidity: 63,
			uv: 8.6,
			pressureHpa: 1004,
			cloudPct: 90
		},
		{
			// The gap. See the note above: this is what a `NaN` looks like once it
			// has been through the envelope.
			t: '2026-08-28T12:00',
			tempC: null,
			precipProb: null,
			precipMm: null,
			code: null,
			windKph: null,
			windDeg: null,
			humidity: null,
			uv: null,
			pressureHpa: null,
			cloudPct: null
		}
	],
	daily: [
		{
			date: '2026-08-28',
			code: 61,
			maxC: 34.1,
			minC: 26.0,
			sunrise: '2026-08-28T05:32',
			sunset: '2026-08-28T18:16',
			precipProbMax: 60
		},
		{
			date: '2026-08-29',
			code: 3,
			maxC: 33.2,
			minC: 25.7,
			sunrise: '2026-08-29T05:32',
			sunset: '2026-08-29T18:15',
			precipProbMax: 20
		}
	],
	air: { europeanAqi: 42, pm25: 11.3, pm10: 18, ozone: 60, no2: 12 },
	attribution: 'Weather data by Open-Meteo (CC BY 4.0)'
};

export const WEATHER_OK: TpApiResponse<TpWeatherPayload> = {
	ok: true,
	data: WEATHER_PAYLOAD,
	meta: { cachedAt: 1_787_900_000, source: 'open-meteo', stale: false }
};

/** doc 11 §4: served past the TTL because upstream failed. */
export const WEATHER_STALE: TpApiResponse<TpWeatherPayload> = {
	ok: true,
	data: WEATHER_PAYLOAD,
	meta: { cachedAt: 1_787_800_000, source: 'open-meteo', stale: true }
};
