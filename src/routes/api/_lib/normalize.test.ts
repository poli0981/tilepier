import { describe, expect, it } from 'vitest';
import {
	normalizeAir,
	normalizeDaily,
	normalizeHourly,
	normalizeNominatim,
	normalizePhoton,
	normalizeWeather,
	WEATHER_HOURS
} from './normalize';

/**
 * doc 11 §1.4 — upstream quirks die at the edge.
 *
 * Every case here is about somebody else's JSON being wrong in a way that must
 * not produce a 503: a missing column, a short array, a string where a number
 * was promised. The alternative to a partial forecast is no forecast, and doc
 * 08 §1's tile can render a temperature without a UV index.
 */

const HOURLY = {
	time: ['2026-08-28T09:00', '2026-08-28T10:00'],
	temperature_2m: [31.4, 32.8],
	precipitation_probability: [10, 15],
	precipitation: [0, 0.2],
	weather_code: [2, 61],
	wind_speed_10m: [11, 14],
	wind_direction_10m: [120, 130],
	relative_humidity_2m: [70, 66],
	uv_index: [7.2, 8.1],
	surface_pressure: [1006, 1005]
};

const DAILY = {
	time: ['2026-08-28', '2026-08-29'],
	weather_code: [61, 3],
	temperature_2m_max: [34.1, 33.2],
	temperature_2m_min: [26.0, 25.7],
	sunrise: ['2026-08-28T05:32', '2026-08-29T05:32'],
	sunset: ['2026-08-28T18:16', '2026-08-29T18:15'],
	precipitation_probability_max: [60, 20]
};

describe('normalizeHourly', () => {
	it('turns nine parallel arrays into rows', () => {
		// The actual work of the normalisation: upstream makes a reader index
		// nine arrays in step to describe one hour.
		const rows = normalizeHourly(HOURLY);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			t: '2026-08-28T09:00',
			tempC: 31.4,
			precipProb: 10,
			precipMm: 0,
			code: 2,
			windKph: 11,
			windDeg: 120,
			humidity: 70,
			uv: 7.2,
			pressureHpa: 1006
		});
	});

	it('caps at 48 hours, not the 168 upstream returns', () => {
		const long = {
			...HOURLY,
			time: Array.from({ length: 168 }, (_v, i) => `h${String(i)}`),
			temperature_2m: Array.from({ length: 168 }, () => 20)
		};
		expect(normalizeHourly(long)).toHaveLength(WEATHER_HOURS);
	});

	it('keeps a gap as NaN rather than substituting a zero', () => {
		// 0 °C is a temperature. A row that says zero where it means "missing"
		// would draw a line to freezing on the chart.
		const gappy = { ...HOURLY, temperature_2m: [31.4] };
		const rows = normalizeHourly(gappy);
		expect(rows[0]?.tempC).toBe(31.4);
		expect(Number.isNaN(rows[1]?.tempC)).toBe(true);
	});

	it('survives a column that is missing entirely', () => {
		const { uv_index: _dropped, ...without } = HOURLY;
		const rows = normalizeHourly(without);
		expect(rows).toHaveLength(2);
		expect(Number.isNaN(rows[0]?.uv)).toBe(true);
		expect(rows[0]?.tempC).toBe(31.4);
	});

	it('survives a column of the wrong type', () => {
		const rows = normalizeHourly({ ...HOURLY, temperature_2m: ['warm', 'warmer'] });
		expect(Number.isNaN(rows[0]?.tempC)).toBe(true);
	});

	it('is empty rather than throwing for nothing at all', () => {
		expect(normalizeHourly(undefined)).toEqual([]);
		expect(normalizeHourly(null)).toEqual([]);
		expect(normalizeHourly({})).toEqual([]);
	});
});

describe('normalizeDaily', () => {
	it('carries the whole week, which the 7-day strip needs', () => {
		const rows = normalizeDaily(DAILY);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toEqual({
			date: '2026-08-28',
			code: 61,
			maxC: 34.1,
			minC: 26.0,
			sunrise: '2026-08-28T05:32',
			sunset: '2026-08-28T18:16',
			precipProbMax: 60
		});
	});

	it('leaves a missing sunrise as an empty string, not undefined', () => {
		// `exactOptionalPropertyTypes` (doc 20 §2) and a caller that formats it.
		const rows = normalizeDaily({ ...DAILY, sunrise: [] });
		expect(rows[0]?.sunrise).toBe('');
	});

	it('is empty for nothing at all', () => {
		expect(normalizeDaily(undefined)).toEqual([]);
	});
});

describe('normalizeAir', () => {
	it('reads the first hour, which is now for a gauge', () => {
		expect(
			normalizeAir({
				european_aqi: [42, 44],
				pm2_5: [11.3],
				pm10: [18],
				ozone: [60],
				nitrogen_dioxide: [12]
			})
		).toEqual({ europeanAqi: 42, pm25: 11.3, pm10: 18, ozone: 60, no2: 12 });
	});

	it('is null when the call failed, so the forecast still ships', () => {
		// doc 10 §2 makes AQI a nice-to-have. A tile with a temperature and no
		// AQI is useful; a 503 is not.
		expect(normalizeAir(null)).toBeNull();
		expect(normalizeAir(undefined)).toBeNull();
	});

	it('nulls the pollutants it did not get rather than reporting zero', () => {
		const air = normalizeAir({ european_aqi: [42] });
		expect(air?.europeanAqi).toBe(42);
		expect(air?.pm25).toBeNull();
	});
});

describe('normalizeWeather', () => {
	it('assembles the payload doc 10 §2 requires', () => {
		const payload = normalizeWeather(
			{ lat: 21.02, lon: 105.85 },
			{ timezone: 'Asia/Ho_Chi_Minh', hourly: HOURLY, daily: DAILY },
			{ european_aqi: [42] }
		);

		expect(payload.place).toEqual({ lat: 21.02, lon: 105.85, timezone: 'Asia/Ho_Chi_Minh' });
		expect(payload.hourly).toHaveLength(2);
		expect(payload.daily).toHaveLength(2);
		expect(payload.air?.europeanAqi).toBe(42);
	});

	it('carries the attribution in the payload so the UI cannot forget it', () => {
		// doc 10 §2, doc 16 §5. A credit the UI has to remember is a credit that
		// goes missing in a refactor.
		const payload = normalizeWeather({ lat: 0, lon: 0 }, {}, null);
		expect(payload.attribution).toContain('Open-Meteo');
	});

	it('falls back to UTC rather than to undefined for a missing timezone', () => {
		expect(normalizeWeather({ lat: 0, lon: 0 }, {}, null).place.timezone).toBe('UTC');
	});

	it('produces a whole payload from an empty upstream response', () => {
		const payload = normalizeWeather({ lat: 1, lon: 2 }, {}, null);
		expect(payload.hourly).toEqual([]);
		expect(payload.daily).toEqual([]);
		expect(payload.air).toBeNull();
	});
});

describe('normalizePhoton', () => {
	const feature = (
		properties: Record<string, unknown>,
		coordinates: unknown = [105.85, 21.02]
	) => ({
		type: 'Feature',
		geometry: { type: 'Point', coordinates },
		properties
	});

	it('reads GeoJSON into the shared shape', () => {
		const results = normalizePhoton({
			features: [feature({ name: 'Hà Nội', country: 'Việt Nam', osm_value: 'city' })]
		});
		expect(results).toEqual([
			{
				name: 'Hà Nội',
				displayName: 'Hà Nội, Việt Nam',
				lat: 21.02,
				lon: 105.85,
				type: 'city'
			}
		]);
	});

	it('builds a display name that tells two places of one name apart', () => {
		// Which is the whole job of a result list.
		const results = normalizePhoton({
			features: [
				feature({ name: 'Springfield', state: 'Illinois', country: 'United States' }),
				feature({ name: 'Springfield', state: 'Missouri', country: 'United States' })
			]
		});
		expect(results[0]?.displayName).not.toBe(results[1]?.displayName);
	});

	it('does not repeat the name in its own context', () => {
		const results = normalizePhoton({
			features: [feature({ name: 'Hà Nội', city: 'Hà Nội', country: 'Việt Nam' })]
		});
		expect(results[0]?.displayName).toBe('Hà Nội, Việt Nam');
	});

	it('skips a feature with no coordinates rather than emitting NaN', () => {
		// `null`, not `undefined` — an omitted argument takes the helper's
		// default and would test nothing.
		const results = normalizePhoton({
			features: [feature({ name: 'Nowhere' }, null), feature({ name: 'Hà Nội' })]
		});
		expect(results.map((r) => r.name)).toEqual(['Hà Nội']);
	});

	it('is empty for a body that is not GeoJSON', () => {
		expect(normalizePhoton({})).toEqual([]);
		expect(normalizePhoton(null)).toEqual([]);
		expect(normalizePhoton('nope')).toEqual([]);
	});
});

describe('normalizeNominatim', () => {
	it('reads jsonv2, whose lat and lon are strings', () => {
		// The one shape difference that would silently produce NaN if the two
		// upstreams shared a parser.
		const results = normalizeNominatim([
			{
				lat: '21.0245',
				lon: '105.8412',
				display_name: 'Hà Nội, Việt Nam',
				name: 'Hà Nội',
				type: 'city'
			}
		]);
		expect(results[0]).toEqual({
			name: 'Hà Nội',
			displayName: 'Hà Nội, Việt Nam',
			lat: 21.0245,
			lon: 105.8412,
			type: 'city'
		});
	});

	it('takes the name off the front of the display name when there is none', () => {
		const results = normalizeNominatim([
			{ lat: '1', lon: '2', display_name: 'Đống Đa, Hà Nội, Việt Nam' }
		]);
		expect(results[0]?.name).toBe('Đống Đa');
	});

	it('skips a row whose coordinates will not parse', () => {
		const results = normalizeNominatim([
			{ lat: 'north', lon: '2', display_name: 'x' },
			{ lat: '1', lon: '2', display_name: 'y' }
		]);
		expect(results).toHaveLength(1);
	});

	it('is empty for a body that is not an array', () => {
		expect(normalizeNominatim({ error: 'nope' })).toEqual([]);
		expect(normalizeNominatim(null)).toEqual([]);
	});
});
