import type {
	TpAirQuality,
	TpGeocodeResult,
	TpWeatherDay,
	TpWeatherHour,
	TpWeatherPayload
} from '$lib/api-types';

/**
 * Upstream shapes die here (doc 11 §1.4, doc 10 §2).
 *
 * Every function is total and defensive in the same way `core/storage/local.ts`
 * is, and for the same reason: this is parsing somebody else's JSON. A missing
 * array, a short array, a string where a number was promised — none of them may
 * throw, because the alternative to a partial forecast is a 503 for a payload
 * that was 95 % fine.
 *
 * Separate from the endpoints so it can be tested against recorded upstream
 * shapes without standing up a request (doc 19 §3.5).
 */

/** doc 08 §1 needs 24 hours of chart and a 12-hour sparkline; 48 covers either
 *  from any point in the day. Upstream returns 168. */
export const WEATHER_HOURS = 48;

function numbers(value: unknown): number[] {
	return Array.isArray(value) ? value.map((n) => (typeof n === 'number' ? n : Number.NaN)) : [];
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.map((s) => (typeof s === 'string' ? s : '')) : [];
}

/** `NaN` is what a missing column produces; the row keeps it rather than
 *  substituting a zero, because 0 °C is a temperature and a gap is not. */
function at(list: number[], index: number): number {
	return list[index] ?? Number.NaN;
}

export function normalizeHourly(hourly: unknown, limit = WEATHER_HOURS): TpWeatherHour[] {
	const source = (hourly ?? {}) as Record<string, unknown>;
	const time = strings(source['time']);
	const temp = numbers(source['temperature_2m']);
	const prob = numbers(source['precipitation_probability']);
	const precip = numbers(source['precipitation']);
	const code = numbers(source['weather_code']);
	const wind = numbers(source['wind_speed_10m']);
	const deg = numbers(source['wind_direction_10m']);
	const humidity = numbers(source['relative_humidity_2m']);
	const uv = numbers(source['uv_index']);
	const pressure = numbers(source['surface_pressure']);

	return time.slice(0, limit).map((t, i) => ({
		t,
		tempC: at(temp, i),
		precipProb: at(prob, i),
		precipMm: at(precip, i),
		code: at(code, i),
		windKph: at(wind, i),
		windDeg: at(deg, i),
		humidity: at(humidity, i),
		uv: at(uv, i),
		pressureHpa: at(pressure, i)
	}));
}

export function normalizeDaily(daily: unknown): TpWeatherDay[] {
	const source = (daily ?? {}) as Record<string, unknown>;
	const date = strings(source['time']);
	const code = numbers(source['weather_code']);
	const max = numbers(source['temperature_2m_max']);
	const min = numbers(source['temperature_2m_min']);
	const sunrise = strings(source['sunrise']);
	const sunset = strings(source['sunset']);
	const prob = numbers(source['precipitation_probability_max']);

	return date.map((day, i) => ({
		date: day,
		code: at(code, i),
		maxC: at(max, i),
		minC: at(min, i),
		sunrise: sunrise[i] ?? '',
		sunset: sunset[i] ?? '',
		precipProbMax: at(prob, i)
	}));
}

/**
 * The first hour of the air-quality series, which is "now" for a gauge.
 * `null` when the call failed — doc 10 §2 makes AQI a nice-to-have that must
 * not cost the forecast.
 */
export function normalizeAir(hourly: unknown): TpAirQuality | null {
	if (hourly === null || hourly === undefined) return null;
	const source = hourly as Record<string, unknown>;

	const first = (key: string): number | null => {
		const value = numbers(source[key])[0];
		return value === undefined || Number.isNaN(value) ? null : value;
	};

	return {
		europeanAqi: first('european_aqi'),
		pm25: first('pm2_5'),
		pm10: first('pm10'),
		ozone: first('ozone'),
		no2: first('nitrogen_dioxide')
	};
}

export function normalizeWeather(
	coords: { lat: number; lon: number },
	forecast: Record<string, unknown>,
	air: unknown
): TpWeatherPayload {
	return {
		place: {
			lat: coords.lat,
			lon: coords.lon,
			timezone: typeof forecast['timezone'] === 'string' ? forecast['timezone'] : 'UTC'
		},
		hourly: normalizeHourly(forecast['hourly']),
		daily: normalizeDaily(forecast['daily']),
		air: normalizeAir(air),
		attribution: 'Weather data by Open-Meteo (CC BY 4.0)'
	};
}

/* ─────────────────────────────────────────────────────────────── geocoding */

/** Photon answers GeoJSON: a feature per place, with the name in `properties`. */
export function normalizePhoton(body: unknown): TpGeocodeResult[] {
	const features = (body as { features?: unknown })?.features;
	if (!Array.isArray(features)) return [];

	const out: TpGeocodeResult[] = [];
	for (const raw of features) {
		const feature = raw as {
			properties?: Record<string, unknown>;
			geometry?: { coordinates?: unknown };
		};
		const properties = feature.properties ?? {};
		const coordinates = feature.geometry?.coordinates;
		if (!Array.isArray(coordinates)) continue;

		const lon = coordinates[0];
		const lat = coordinates[1];
		const name = properties['name'];
		if (typeof lat !== 'number' || typeof lon !== 'number' || typeof name !== 'string') continue;

		// City, state, country — enough to tell two places of the same name
		// apart, which is the whole job of a search result list.
		const context = ['city', 'state', 'country']
			.map((key) => properties[key])
			.filter(
				(value): value is string => typeof value === 'string' && value !== '' && value !== name
			);

		out.push({
			name,
			displayName: [name, ...context].join(', '),
			lat,
			lon,
			type: typeof properties['osm_value'] === 'string' ? properties['osm_value'] : 'place'
		});
	}
	return out;
}

/** Nominatim answers `jsonv2`: a flat array, with lat and lon as strings. */
export function normalizeNominatim(body: unknown): TpGeocodeResult[] {
	if (!Array.isArray(body)) return [];

	const out: TpGeocodeResult[] = [];
	for (const raw of body) {
		const row = raw as Record<string, unknown>;
		const lat = Number(row['lat']);
		const lon = Number(row['lon']);
		const displayName = row['display_name'];
		if (!Number.isFinite(lat) || !Number.isFinite(lon) || typeof displayName !== 'string') continue;

		const name =
			typeof row['name'] === 'string' && row['name'] !== ''
				? row['name']
				: (displayName.split(',')[0] ?? displayName);

		out.push({
			name,
			displayName,
			lat,
			lon,
			type: typeof row['type'] === 'string' ? row['type'] : 'place'
		});
	}
	return out;
}
