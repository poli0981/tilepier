import type {
	TpAirQuality,
	TpCryptoCandle,
	TpCryptoInterval,
	TpCryptoKlinesPayload,
	TpCryptoQuote,
	TpCryptoTickerPayload,
	TpFxPayload,
	TpGeocodeResult,
	TpStockCandle,
	TpStockInterval,
	TpStockQuote,
	TpStockSearchPayload,
	TpStockSearchResult,
	TpStockSeriesPayload,
	TpWeatherDay,
	TpWeatherHour,
	TpWeatherPayload
} from '$lib/api-types';
import { isMarketSymbol } from '$lib/shared-constants';
import { FINNHUB_ATTRIBUTION } from './finnhub';
import { TWELVEDATA_ATTRIBUTION } from './twelvedata';

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

/* ─────────────────────────────────────────────────────────── fx (doc 10 §3) */

/**
 * doc 10 §1 and doc 16 §5: ExchangeRate-API's terms ask for this link text
 * wherever rates appear. It rides inside the payload so a surface cannot render
 * a rate without also having been handed the credit for it.
 */
export const FX_ATTRIBUTION = 'Rates By Exchange Rate API';

/** ISO 4217 is three uppercase letters, and anything else in that object is
 *  either a new upstream field or a mistake. Neither belongs in a rate table. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/**
 * A rate table with every row we are not willing to divide by removed.
 *
 * Zero and negative rates go as well as non-numbers: the client's cross rate is
 * `rates[to] / rates[from]`, so a zero here is an `Infinity` on somebody's tile
 * rather than an obviously-wrong number.
 */
function rateTable(value: unknown): Record<string, number> {
	if (value === null || typeof value !== 'object') return {};

	const table: Record<string, number> = {};
	for (const [code, rate] of Object.entries(value as Record<string, unknown>)) {
		if (!CURRENCY_CODE.test(code)) continue;
		if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) continue;
		table[code] = rate;
	}
	return table;
}

/** Upstream stamps are unix *seconds*; everything inside the app is ms. */
function unixMs(value: unknown): number | null {
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
	return value * 1000;
}

/**
 * open.er-api.com's daily table, plus yesterday's if we kept one.
 *
 * `nextUpdateAt` is returned rather than applied: the cap it feeds is cache
 * policy, and this module has no business importing `CACHE_POLICY` (doc 11
 * §1.4). The endpoint decides what to do with it.
 *
 * `previous` is re-validated even though we wrote it ourselves. A KV value with
 * no expiry outlives the build that wrote it, so by the time it is read back it
 * is somebody else's JSON like any other.
 */
/**
 * Upstream’s own publication stamp, read on its own.
 *
 * The endpoint needs it *before* it can normalize: the permanent snapshot is
 * keyed on the date upstream published, not the date our clock says. Those
 * differ for the ten minutes between UTC midnight and ER-API’s daily push, and
 * a snapshot written in that window under tomorrow’s date is a wrong number in
 * a store that has no expiry and never gets rewritten (doc 10 §3).
 */
export function fxAsOf(body: unknown, now: number): number {
	const source = (body ?? {}) as Record<string, unknown>;
	return unixMs(source['time_last_update_unix']) ?? now;
}

export function normalizeFx(
	body: unknown,
	previous: { date: string; rates: Record<string, number> } | null,
	now: number
): TpFxPayload {
	const source = (body ?? {}) as Record<string, unknown>;
	const rates = rateTable(source['rates']);

	// The base is its own unit. Upstream has always sent `USD: 1`, but every
	// conversion the client makes divides by `rates[from]`, so a table missing
	// its own base turns every USD row into `undefined` rather than into a
	// visibly wrong number. Only when there is a table at all — an empty one is
	// how the endpoint recognises an upstream that answered without answering.
	if (rates['USD'] === undefined && Object.keys(rates).length > 0) rates['USD'] = 1;

	const prevRates = previous === null ? {} : rateTable(previous.rates);
	const hasPrev = Object.keys(prevRates).length > 0;

	return {
		base: 'USD',
		rates,
		asOf: fxAsOf(body, now),
		nextUpdateAt: unixMs(source['time_next_update_unix']),
		prevRates: hasPrev ? prevRates : null,
		prevDate: hasPrev && previous !== null ? previous.date : null,
		attribution: FX_ATTRIBUTION
	};
}

/* ──────────────────────────────────────────────────────── crypto (doc 10 §4) */

/** doc 10 §1: public market data, keyless, shown rather than resold — and doc
 *  16 §5 wants the credit line in the markets detail. Binance.US since
 *  2026-09-23 (`_lib/binance.ts` has why). Carried in the payload so the UI
 *  cannot forget it, the way the weather and fx payloads carry theirs. */
export const CRYPTO_ATTRIBUTION = 'Crypto data by Binance.US';

/**
 * Binance sends every price, size and percentage as a **string** — `"63120.41"`,
 * not `63120.41` — so nothing here can read a field and trust it. The two
 * timestamps are the exception and arrive as numbers, which is why this accepts
 * both spellings rather than parsing one.
 */
function decimal(value: unknown): number | null {
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value !== 'string' || value.trim() === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * One `/ticker/24hr` row, or `null` when it does not carry a usable price.
 *
 * A non-positive price is refused alongside a missing one, for the reason
 * `normalizeFx` refuses a non-positive rate: it is not a number the UI can
 * divide by or draw, and letting it through turns a bad field upstream into an
 * `Infinity` on screen rather than into a row the tile knows how to explain.
 */
export function normalizeCryptoQuote(row: unknown, now: number): TpCryptoQuote | null {
	const source = (row ?? {}) as Record<string, unknown>;

	const rawSymbol = source['symbol'];
	const symbol = typeof rawSymbol === 'string' ? rawSymbol.trim().toUpperCase() : '';
	const price = decimal(source['lastPrice']);
	if (symbol === '' || price === null || price <= 0) return null;

	// A fraction, not a percentage (doc 09 §1's chip lets `Intl` place the sign).
	const percent = decimal(source['priceChangePercent']);

	return {
		symbol,
		price,
		change24h: percent === null ? null : percent / 100,
		high24h: decimal(source['highPrice']),
		low24h: decimal(source['lowPrice']),
		volume24h: decimal(source['volume']),
		at: decimal(source['closeTime']) ?? now
	};
}

/**
 * The batched ticker, keyed by every symbol the caller asked for.
 *
 * **Driven by `requested` rather than by the response**, which is what makes a
 * missing row expressible at all: upstream simply omits a symbol it has nothing
 * for, and an object built from the response would omit it too — leaving the
 * tile unable to tell "no answer" from "never asked". doc 09 §1 needs those
 * apart to render its row error chip.
 *
 * Accepts a single object as well as an array, because the endpoint's
 * per-symbol fallback re-uses this with one row at a time and Binance answers
 * `?symbol=` and `?symbols=` with different shapes.
 */
export function normalizeCryptoTicker(
	body: unknown,
	requested: readonly string[],
	now: number
): TpCryptoTickerPayload {
	const rows = Array.isArray(body) ? body : [body];
	const bySymbol = new Map<string, TpCryptoQuote>();

	for (const row of rows) {
		const quote = normalizeCryptoQuote(row, now);
		if (quote !== null) bySymbol.set(quote.symbol, quote);
	}

	const quotes: Record<string, TpCryptoQuote | null> = {};
	for (const symbol of requested) quotes[symbol] = bySymbol.get(symbol) ?? null;

	return { quotes, attribution: CRYPTO_ATTRIBUTION };
}

/**
 * `[openTime, open, high, low, close, volume]` from a Binance klines row.
 *
 * Upstream sends a twelve-element array whose OHLCV members are **strings** and
 * whose timestamps are numbers, plus five fields nothing here reads. A row that
 * cannot produce six finite numbers is dropped rather than zero-filled: the
 * chart plots against a time axis, so a gap is a gap, and a candle at zero is a
 * crash that never happened.
 *
 * Not exported: `normalizeCryptoKlines` is its only caller, and knip is
 * CI-blocking on an export nothing imports. The cases below reach it through
 * that one.
 */
function normalizeCryptoCandle(row: unknown): TpCryptoCandle | null {
	if (!Array.isArray(row)) return null;

	const openTime = decimal(row[0]);
	const open = decimal(row[1]);
	const high = decimal(row[2]);
	const low = decimal(row[3]);
	const close = decimal(row[4]);
	const volume = decimal(row[5]);

	if (openTime === null || open === null || high === null || low === null) return null;
	if (close === null || volume === null) return null;
	// A non-positive price is refused here for the same reason `normalizeFx`
	// refuses a non-positive rate: it is not something a chart can draw.
	if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;

	return [openTime, open, high, low, close, volume];
}

export function normalizeCryptoKlines(
	body: unknown,
	symbol: string,
	interval: TpCryptoInterval
): TpCryptoKlinesPayload {
	const rows = Array.isArray(body) ? body : [];
	const candles: TpCryptoCandle[] = [];

	for (const row of rows) {
		const candle = normalizeCryptoCandle(row);
		if (candle !== null) candles.push(candle);
	}

	// Upstream returns them ascending already; sorted anyway because the chart
	// and the client-side window both assume it, and an assumption that costs one
	// comparison per candle is not worth leaving to upstream.
	candles.sort((a, b) => a[0] - b[0]);

	return { symbol, interval, candles, attribution: CRYPTO_ATTRIBUTION };
}

/* ──────────────────────────────────────────────────────── stocks (doc 10 §5) */

/**
 * One Finnhub `/quote` answer, or `null` when it carries no usable price.
 *
 * Finnhub sends numbers as numbers (`{c, d, dp, h, l, o, pc, t}`), and for a
 * symbol it does not know it still answers 200 — with every field zero. That is
 * the case `null` exists for: a zero price is not a quote, and the tile has a
 * row chip that says so (doc 09 §1). The surrounding figures are refused at
 * zero too, because a zero high is not a claim Finnhub means to make.
 */
export function normalizeStockQuote(
	body: unknown,
	symbol: string,
	now: number
): TpStockQuote | null {
	const source = (body ?? {}) as Record<string, unknown>;
	const price = decimal(source['c']);
	if (price === null || price <= 0) return null;

	const positive = (value: unknown): number | null => {
		const parsed = decimal(value);
		return parsed !== null && parsed > 0 ? parsed : null;
	};
	const percent = decimal(source['dp']);
	const seconds = decimal(source['t']);

	return {
		symbol,
		price,
		changeDay: percent === null ? null : percent / 100,
		high: positive(source['h']),
		low: positive(source['l']),
		open: positive(source['o']),
		prevClose: positive(source['pc']),
		at: seconds !== null && seconds > 0 ? seconds * 1000 : now
	};
}

/**
 * A Twelve Data bar's `datetime` as Unix ms. The series is requested with
 * `timezone=UTC`, so `2026-09-22 15:45:00` and `2026-09-22` are both UTC and
 * no exchange calendar is needed; anything else is `null`.
 */
function barTime(value: unknown): number | null {
	if (typeof value !== 'string') return null;
	const iso = /^\d{4}-\d{2}-\d{2}$/.test(value)
		? `${value}T00:00:00Z`
		: `${value.replace(' ', 'T')}Z`;
	const parsed = Date.parse(iso);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `/time_series` → `[openTime, open, high, low, close, volume]`, ascending.
 *
 * Twelve Data sends every OHLCV value as a string, like Binance. A bar that
 * cannot produce six finite numbers is dropped rather than zero-filled — the
 * same rule, and the same reason: the chart plots against a time axis. Volume
 * alone may be absent (an index has none), and is 0 then rather than a reason
 * to lose the bar.
 */
export function normalizeStockSeries(
	body: unknown,
	symbol: string,
	interval: TpStockInterval
): TpStockSeriesPayload {
	const values = (body as { values?: unknown } | null)?.values;
	const rows = Array.isArray(values) ? values : [];
	const candles: TpStockCandle[] = [];

	for (const row of rows) {
		const source = (row ?? {}) as Record<string, unknown>;
		const openTime = barTime(source['datetime']);
		const open = decimal(source['open']);
		const high = decimal(source['high']);
		const low = decimal(source['low']);
		const close = decimal(source['close']);
		if (openTime === null || open === null || high === null || low === null || close === null) {
			continue;
		}
		if (open <= 0 || high <= 0 || low <= 0 || close <= 0) continue;
		candles.push([openTime, open, high, low, close, decimal(source['volume']) ?? 0]);
	}

	candles.sort((a, b) => a[0] - b[0]);
	return { symbol, interval, candles, attribution: TWELVEDATA_ATTRIBUTION };
}

/** How many search results the detail's suggestion list is given. */
const SEARCH_LIMIT = 10;

/**
 * Finnhub `/search` → symbols a watchlist can hold.
 *
 * Common stock only, and only symbols that pass doc 10 §5's allowlist — the
 * same check the manager applies to a typed symbol, so a suggestion can never
 * be one the watchlist would then refuse. The description is kept as text for
 * a text node (CLAUDE.md rule 7), never markup.
 */
export function normalizeStockSearch(body: unknown, query: string): TpStockSearchPayload {
	const list = (body as { result?: unknown } | null)?.result;
	const rows = Array.isArray(list) ? list : [];
	const results: TpStockSearchResult[] = [];
	const seen = new Set<string>();

	for (const row of rows) {
		const source = (row ?? {}) as Record<string, unknown>;
		if (source['type'] !== 'Common Stock') continue;
		const raw = source['symbol'];
		const symbol = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
		if (!isMarketSymbol(symbol) || seen.has(symbol)) continue;
		const description = source['description'];
		seen.add(symbol);
		results.push({ symbol, name: typeof description === 'string' ? description.trim() : '' });
		if (results.length === SEARCH_LIMIT) break;
	}

	return { query, results, attribution: FINNHUB_ATTRIBUTION };
}
