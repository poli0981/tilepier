import { describe, expect, it } from 'vitest';
import {
	fxAsOf,
	normalizeAir,
	normalizeDaily,
	normalizeFx,
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
	surface_pressure: [1006, 1005],
	cloud_cover: [40, 65]
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
	it('turns ten parallel arrays into rows', () => {
		// The actual work of the normalisation: upstream makes a reader index ten
		// arrays in step to describe one hour. `cloud_cover` joined them in
		// Week 4 for doc 08 §1's cloud band.
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
			pressureHpa: 1006,
			cloudPct: 40
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
	/** A day of readings, one per hour, valued so the index is readable. */
	const DAY = {
		time: Array.from({ length: 24 }, (_, h) => `2026-08-28T${String(h).padStart(2, '0')}:00`),
		european_aqi: Array.from({ length: 24 }, (_, h) => 100 + h),
		pm2_5: Array.from({ length: 24 }, (_, h) => h),
		pm10: Array.from({ length: 24 }, (_, h) => h * 2),
		ozone: Array.from({ length: 24 }, (_, h) => h * 3),
		nitrogen_dioxide: Array.from({ length: 24 }, (_, h) => h * 4)
	};

	it('reads the hour it is AT THE PLACE, not the first row', () => {
		// The bug this replaced: the endpoint sent no `timezone` at all, so the
		// series began at 00:00 GMT and `hourly[0]` was called "now". For Hanoi
		// that is 07:00 local — the reading was wrong by the whole offset
		// everywhere except Britain in winter, and nothing rendered it, so
		// nothing said so.
		const at = Date.UTC(2026, 7, 28, 7, 30); // 14:30 in Hanoi
		expect(normalizeAir(DAY, 'Asia/Ho_Chi_Minh', at)?.europeanAqi).toBe(114);
	});

	it('lands on a different row for a different zone at the same instant', () => {
		// The assertion the first one cannot make on its own: an implementation
		// that ignored the zone would pass it by coincidence for one place.
		const at = Date.UTC(2026, 7, 28, 7, 30);
		expect(normalizeAir(DAY, 'Europe/London', at)?.europeanAqi).toBe(108);
		expect(normalizeAir(DAY, 'UTC', at)?.europeanAqi).toBe(107);
	});

	it('falls back to the first row rather than losing the reading', () => {
		// An unknown zone, or a series that does not cover the hour, degrades to
		// what the old code always did. doc 10 §2: AQI must never cost the
		// forecast.
		const at = Date.UTC(2026, 7, 29, 7, 30); // a day the series does not hold
		expect(normalizeAir(DAY, 'Asia/Ho_Chi_Minh', at)?.europeanAqi).toBe(100);
		expect(normalizeAir(DAY, 'Not/AZone', at)?.europeanAqi).toBe(100);
	});

	it('reads the first hour when there are no stamps to match against', () => {
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

describe('normalizeFx (doc 10 §3)', () => {
	/** 2026-08-31T10:00:00Z, standing in for a clock the tests do not control. */
	const NOW = Date.parse('2026-08-31T10:00:00Z');

	const BODY = {
		result: 'success',
		time_last_update_unix: 1_788_134_551,
		time_next_update_unix: 1_788_221_421,
		base_code: 'USD',
		rates: { USD: 1, VND: 26_006.374497, EUR: 0.862295 }
	};

	it('reads upstream stamps as seconds and reports them as milliseconds', () => {
		const payload = normalizeFx(BODY, null, NOW);
		expect(payload.asOf).toBe(1_788_134_551_000);
		expect(payload.nextUpdateAt).toBe(1_788_221_421_000);
	});

	it('falls back to our clock when upstream did not stamp the table', () => {
		expect(normalizeFx({ rates: { VND: 1 } }, null, NOW).asOf).toBe(NOW);
		expect(fxAsOf({}, NOW)).toBe(NOW);
	});

	it('reports no next update rather than inventing one', () => {
		// The cap is then simply not applied, and doc 11 §4's row stands alone.
		expect(normalizeFx({ rates: { VND: 1 } }, null, NOW).nextUpdateAt).toBeNull();
		expect(normalizeFx({ ...BODY, time_next_update_unix: 0 }, null, NOW).nextUpdateAt).toBeNull();
		expect(
			normalizeFx({ ...BODY, time_next_update_unix: 'soon' }, null, NOW).nextUpdateAt
		).toBeNull();
	});

	it('drops every rate it would not be safe to divide by', () => {
		const payload = normalizeFx(
			{ rates: { VND: 26_006, EUR: '0.86', GBP: -1, JPY: 0, KRW: null, EURO: 1.1, xyz: 2 } },
			null,
			NOW
		);
		// A zero would be an Infinity on somebody's tile; a two-letter or
		// lowercase key is a new upstream field rather than a currency.
		expect(payload.rates).toEqual({ VND: 26_006, USD: 1 });
	});

	it('adds the base to a table that arrived without it', () => {
		// Every conversion divides by `rates[from]`, so a table missing its own
		// base turns every USD row into undefined rather than into a wrong number.
		expect(normalizeFx({ rates: { VND: 26_006 } }, null, NOW).rates['USD']).toBe(1);
	});

	it('leaves an empty table empty, so the endpoint can tell', () => {
		// The one case where *not* helping is the point: an empty table is how
		// `/api/fx` recognises an upstream that answered without answering, and a
		// helpfully-injected `USD: 1` would make it look like an answer.
		expect(normalizeFx({ result: 'error' }, null, NOW).rates).toEqual({});
		expect(normalizeFx(null, null, NOW).rates).toEqual({});
	});

	it('carries yesterday through, re-validated', () => {
		// We wrote that snapshot ourselves, but a KV value with no expiry outlives
		// the build that wrote it, so it gets the same treatment as any other JSON.
		const payload = normalizeFx(
			BODY,
			{ date: '2026-08-30', rates: { USD: 1, VND: 25_951.2, BAD: -3 } },
			NOW
		);
		expect(payload.prevDate).toBe('2026-08-30');
		expect(payload.prevRates).toEqual({ USD: 1, VND: 25_951.2 });
	});

	it('reports no previous day rather than an empty one', () => {
		expect(normalizeFx(BODY, null, NOW).prevRates).toBeNull();
		expect(normalizeFx(BODY, { date: '2026-08-30', rates: {} }, NOW).prevRates).toBeNull();
		expect(normalizeFx(BODY, { date: '2026-08-30', rates: {} }, NOW).prevDate).toBeNull();
	});

	it('carries the attribution doc 16 §5 asks for', () => {
		expect(normalizeFx(BODY, null, NOW).attribution).toBe('Rates By Exchange Rate API');
		expect(normalizeFx(BODY, null, NOW).base).toBe('USD');
	});
});
