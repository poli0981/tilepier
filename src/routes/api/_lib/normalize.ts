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
	const cloud = numbers(source['cloud_cover']);

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
		pressureHpa: at(pressure, i),
		cloudPct: at(cloud, i)
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
/**
 * The wall clock at `timeZone`, truncated to the hour, in the spelling
 * Open-Meteo uses for a local timestamp: `2026-08-30T14`.
 *
 * `Intl` rather than arithmetic, so DST is the platform's problem rather than
 * ours. Workers ship full ICU, and an unknown zone throws — which is why the
 * caller treats a throw as "fall back to index 0" instead of failing the
 * request over a nice-to-have.
 */
function localHourStamp(timeZone: string, at: number): string | null {
	try {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			hour12: false
		}).formatToParts(at);

		const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
		const [y, mo, d, h] = [get('year'), get('month'), get('day'), get('hour')];
		if (y === '' || mo === '' || d === '' || h === '') return null;
		// `hour12: false` gives 24 for midnight in some engines; 00 is what
		// Open-Meteo writes.
		return `${y}-${mo}-${d}T${h === '24' ? '00' : h}`;
	} catch {
		return null;
	}
}

/**
 * The air-quality reading for the hour it is **at the place**.
 *
 * It used to be `hourly[0]`, and the call had no `timezone` parameter at all —
 * so index 0 was 00:00 GMT and the "current" AQI was wrong by the whole offset
 * everywhere but Britain in winter. Nothing rendered it yet, so nothing said
 * so. Both halves are fixed together: the endpoint now asks for `timezone=auto`
 * and this picks the matching hour out of the series.
 *
 * Falls back to index 0 when the stamps cannot be matched, which is what the
 * old code did unconditionally — a stale AQI is a nice-to-have degrading, and
 * doc 10 §2 is explicit that it must never cost the forecast.
 */
export function normalizeAir(
	hourly: unknown,
	timeZone = 'UTC',
	at: number = Date.now()
): TpAirQuality | null {
	if (hourly === null || hourly === undefined) return null;
	const source = hourly as Record<string, unknown>;

	const stamp = localHourStamp(timeZone, at);
	const times = strings(source['time']);
	const found = stamp === null ? -1 : times.findIndex((t) => t.slice(0, 13) === stamp);
	const index = found === -1 ? 0 : found;

	const nth = (key: string): number | null => {
		const value = numbers(source[key])[index];
		return value === undefined || Number.isNaN(value) ? null : value;
	};

	return {
		europeanAqi: nth('european_aqi'),
		pm25: nth('pm2_5'),
		pm10: nth('pm10'),
		ozone: nth('ozone'),
		no2: nth('nitrogen_dioxide')
	};
}

export function normalizeWeather(
	coords: { lat: number; lon: number },
	forecast: Record<string, unknown>,
	air: unknown,
	at: number = Date.now()
): TpWeatherPayload {
	// The forecast's zone, not the air response's: they are the same place, and
	// this one is already the payload's own answer to "where is this".
	const timezone = typeof forecast['timezone'] === 'string' ? forecast['timezone'] : 'UTC';

	return {
		place: { lat: coords.lat, lon: coords.lon, timezone },
		hourly: normalizeHourly(forecast['hourly']),
		daily: normalizeDaily(forecast['daily']),
		air: normalizeAir(air, timezone, at),
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
