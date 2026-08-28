import type { TpApiResponse } from '$lib/api-types';

/**
 * A recorded, trimmed `/api/weather` envelope (doc 19 §1).
 *
 * Trimmed hard on purpose: the real Open-Meteo response carries 168 hourly
 * values across nine variables, and a fixture that large tests the JSON parser
 * rather than the code under test. Three hours and two days is enough to prove
 * the shape survives the round trip, and it stays readable in a diff.
 *
 * The envelope itself is verbatim from doc 11 §2, which is the part that has to
 * be right — `routes/api/weather/+server.ts` builds exactly this.
 */

export interface TpWeatherFixture {
	place: { lat: number; lon: number; timezone: string };
	hourly: unknown;
	daily: unknown;
	airQuality: unknown;
	attribution: string;
}

export const WEATHER_PAYLOAD: TpWeatherFixture = {
	place: { lat: 21.02, lon: 105.85, timezone: 'Asia/Ho_Chi_Minh' },
	hourly: {
		time: ['2026-08-28T09:00', '2026-08-28T10:00', '2026-08-28T11:00'],
		temperature_2m: [31.4, 32.8, 33.9],
		precipitation_probability: [10, 15, 25],
		weather_code: [2, 3, 61]
	},
	daily: {
		time: ['2026-08-28', '2026-08-29'],
		weather_code: [61, 3],
		temperature_2m_max: [34.1, 33.2],
		temperature_2m_min: [26.0, 25.7],
		sunrise: ['2026-08-28T05:32', '2026-08-29T05:32'],
		sunset: ['2026-08-28T18:16', '2026-08-29T18:15']
	},
	airQuality: {
		time: ['2026-08-28T09:00'],
		european_aqi: [42],
		pm2_5: [11.3]
	},
	attribution: 'Weather data by Open-Meteo (CC BY 4.0)'
};

export const WEATHER_OK: TpApiResponse<TpWeatherFixture> = {
	ok: true,
	data: WEATHER_PAYLOAD,
	meta: { cachedAt: 1_787_900_000, source: 'open-meteo', stale: false }
};

/** doc 11 §4: served past the TTL because upstream failed. */
export const WEATHER_STALE: TpApiResponse<TpWeatherFixture> = {
	ok: true,
	data: WEATHER_PAYLOAD,
	meta: { cachedAt: 1_787_800_000, source: 'open-meteo', stale: true }
};
