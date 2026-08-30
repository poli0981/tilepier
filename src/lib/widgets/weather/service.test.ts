import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TpWeatherPayload } from '$lib/api-types';
import { TpApiError } from '$lib/core/api';
import { WEATHER_OK, WEATHER_PAYLOAD, WEATHER_STALE } from '$lib/core/__fixtures__/weather';
import { cacheKey, geohash, roundCoord } from '$lib/shared-constants';
import {
	currentHourIndex,
	fetchWeather,
	hourlyPoints,
	isGap,
	readSettings,
	sparklinePoints,
	weatherKey,
	weatherUrl
} from './service';

/**
 * The weather tile's logic, in the node project — everything the tile decides
 * before any of it reaches a DOM.
 *
 * A stubbed `fetch` rather than MSW, which is what `core/api.test.ts` uses.
 * The reason is unglamorous: `weatherUrl` returns a *relative* path, because
 * that is what a browser asks for, and undici cannot parse one without an
 * origin — so MSW never gets to see the request. The stub also lets the URL
 * itself be asserted, which is the doc 16 §3 rounding guarantee and worth a
 * test of its own. The envelope client underneath is MSW-covered in
 * `core/api.test.ts`; what is being checked here is this module's mapping.
 */

function stubFetch(body: unknown, init: ResponseInit = {}): ReturnType<typeof vi.fn> {
	const spy = vi.fn(
		() =>
			new Promise<Response>((resolve) => {
				resolve(
					new Response(JSON.stringify(body), {
						...init,
						headers: { 'content-type': 'application/json', ...(init.headers ?? {}) }
					})
				);
			})
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the data key (doc 04 §5)', () => {
	it('spells what the Worker spells, from an unrounded coordinate', () => {
		// The guarantee the whole cache rests on. `shared-constants.test.ts`
		// pins round-then-hash against `parseCoords`; this pins that the widget
		// goes through the same door.
		expect(weatherKey(21.028511, 105.804817)).toBe(
			cacheKey.weather(geohash(roundCoord(21.028511), roundCoord(105.804817)))
		);
	});

	it('collapses two places in one cell onto one key, and one scheduler task', () => {
		// doc 04 §3: the id *is* the key, so this is also the assertion that two
		// tiles on the same city cost one request between them.
		expect(weatherKey(21.03, 105.8)).toBe(weatherKey(21.01, 105.82));
		expect(weatherKey(48.86, 2.35)).not.toBe(weatherKey(21.03, 105.8));
	});

	it('rounds the coordinate in the query string, not just in the key', () => {
		// doc 16 §3: the coarsening has to happen before the request leaves the
		// device. The Worker re-rounds, so a precise coordinate here would reach
		// KV identically and the leak would be invisible from the response.
		expect(weatherUrl(21.028511, 105.804817)).toBe('/api/weather?lat=21.03&lon=105.8');
	});
});

describe('fetchWeather', () => {
	it('unwraps the envelope into payload and meta, at the rounded URL', async () => {
		const spy = stubFetch(WEATHER_OK);
		const reading = await fetchWeather(21.028511, 105.804817)(new AbortController().signal);

		expect(reading.payload.place.timezone).toBe('Asia/Ho_Chi_Minh');
		expect(reading.meta.source).toBe('open-meteo');
		expect(spy.mock.calls[0]?.[0]).toBe('/api/weather?lat=21.03&lon=105.8');
	});

	it('carries the Worker stale flag through rather than swallowing it', async () => {
		// The reason `T` is `{ payload, meta }` at all. `swr` derives its status
		// from the client's own cache age, so a KV entry served past its TTL
		// (doc 11 §4) would otherwise arrive looking fresh and the tile would
		// present an hour-old reading as current.
		stubFetch(WEATHER_STALE);
		const reading = await fetchWeather(21.02, 105.85)(new AbortController().signal);

		expect(reading.meta.stale).toBe(true);
	});

	it('surfaces a 429 as a TpApiError the scheduler can back off on', async () => {
		stubFetch({ ok: false, error: { code: 'RATE_LIMITED', retryAfterS: 30 } }, { status: 429 });

		await expect(fetchWeather(21.02, 105.85)(new AbortController().signal)).rejects.toThrowError(
			TpApiError
		);
	});
});

describe('isGap — the null on the wire', () => {
	it('is true for the null a NaN becomes, which Number.isNaN would miss', () => {
		// `normalize.ts` writes `NaN`; `JSON.stringify` in `_lib/respond.ts` turns
		// it into `null` on the way out. A guard written as `Number.isNaN` reads
		// as correct and passes every in-process test, and lets this through.
		expect(Number.isNaN(null as unknown as number)).toBe(false);
		expect(isGap(null)).toBe(true);
	});

	it('is true for NaN and undefined, false for a real reading', () => {
		expect(isGap(Number.NaN)).toBe(true);
		expect(isGap(undefined)).toBe(true);
		expect(isGap(Number.POSITIVE_INFINITY)).toBe(true);
		expect(isGap(0)).toBe(false);
		expect(isGap(-3.5)).toBe(false);
	});

	it('the recorded envelope really does carry a null, not a NaN', () => {
		// Guards the fixture against being "tidied" back to a NaN, which would
		// silently stop this whole file from testing the wire shape.
		expect(WEATHER_PAYLOAD.hourly[3]?.tempC).toBeNull();
	});
});

describe('currentHourIndex — the place’s clock, not the reader’s', () => {
	/** 2026-08-28T09:30 in Hanoi (UTC+7) is 02:30 UTC. */
	const AT_0930_IN_HANOI = Date.UTC(2026, 7, 28, 2, 30);

	it('picks the hour by the place’s wall clock, from any viewer zone', () => {
		// The fixture is Asia/Ho_Chi_Minh and its first row is 09:00. Read with
		// `new Date(row.t)` this passes only for a reader sitting in Hanoi —
		// which is the developer, the reviewer and the fixture.
		expect(currentHourIndex(WEATHER_PAYLOAD, AT_0930_IN_HANOI)).toBe(0);
	});

	it('advances with the hour', () => {
		expect(currentHourIndex(WEATHER_PAYLOAD, AT_0930_IN_HANOI + 3_600_000)).toBe(1);
		expect(currentHourIndex(WEATHER_PAYLOAD, AT_0930_IN_HANOI + 2 * 3_600_000)).toBe(2);
	});

	it('falls back to the last hour that is not in the future', () => {
		// A cached payload whose window has moved on still has something worth
		// showing; the alternative is a tile that blanks while holding data.
		const later = AT_0930_IN_HANOI + 48 * 3_600_000;
		expect(currentHourIndex(WEATHER_PAYLOAD, later)).toBe(WEATHER_PAYLOAD.hourly.length - 1);
	});

	it('reports -1 when every hour is still ahead', () => {
		const earlier = AT_0930_IN_HANOI - 48 * 3_600_000;
		expect(currentHourIndex(WEATHER_PAYLOAD, earlier)).toBe(-1);
	});

	it('is not fooled by a zone west of GMT', () => {
		// Same instant, a place whose local date is the previous day. If the
		// implementation compared UTC strings this lands on the wrong hour.
		const payload: TpWeatherPayload = {
			...WEATHER_PAYLOAD,
			place: { lat: 40.71, lon: -74.01, timezone: 'America/New_York' },
			hourly: [
				{ ...WEATHER_PAYLOAD.hourly[0]!, t: '2026-08-27T22:00' },
				{ ...WEATHER_PAYLOAD.hourly[1]!, t: '2026-08-27T23:00' },
				{ ...WEATHER_PAYLOAD.hourly[2]!, t: '2026-08-28T00:00' }
			]
		};
		// 2026-08-28T02:30 UTC is 2026-08-27T22:30 in New York (UTC−4, DST).
		expect(currentHourIndex(payload, AT_0930_IN_HANOI)).toBe(0);
	});
});

describe('sparklinePoints', () => {
	it('returns unit coordinates spanning the readings', () => {
		const spark = sparklinePoints(WEATHER_PAYLOAD, 0, 3);
		expect(spark).not.toBeNull();
		expect(spark?.minC).toBe(31.4);
		expect(spark?.maxC).toBe(33.9);
		expect(spark?.hours).toBe(3);

		const first = spark?.segments[0]?.[0];
		const last = spark?.segments[0]?.[2];
		expect(first).toEqual({ x: 0, y: 1 });
		expect(last).toEqual({ x: 1, y: 0 });
	});

	it('breaks the line at a gap instead of drawing through it', () => {
		// doc 10 §2: a gap is not a zero, and it is not a straight line between
		// its neighbours either.
		const spark = sparklinePoints(WEATHER_PAYLOAD, 0, 4);
		expect(spark?.segments).toHaveLength(1);
		expect(spark?.segments[0]).toHaveLength(3);
		expect(spark?.hours).toBe(4);
	});

	it('takes min and max over finite readings only', () => {
		// `Math.min` over an array containing a gap is the gap.
		const spark = sparklinePoints(WEATHER_PAYLOAD, 0, 4);
		expect(Number.isFinite(spark?.minC)).toBe(true);
		expect(Number.isFinite(spark?.maxC)).toBe(true);
	});

	it('is null when there is not enough to draw', () => {
		expect(sparklinePoints(WEATHER_PAYLOAD, 0, 1)).toBeNull();
		expect(sparklinePoints(WEATHER_PAYLOAD, 3, 12)).toBeNull();
	});

	it('draws a flat run down the middle rather than dividing by zero', () => {
		const flat: TpWeatherPayload = {
			...WEATHER_PAYLOAD,
			hourly: [
				{ ...WEATHER_PAYLOAD.hourly[0]!, tempC: 30 },
				{ ...WEATHER_PAYLOAD.hourly[1]!, tempC: 30 }
			]
		};
		const spark = sparklinePoints(flat, 0, 12);
		expect(spark?.segments[0]?.every((p) => p.y === 1)).toBe(true);
	});
});

describe('hourlyPoints — instants, not local strings', () => {
	it('resolves each hour through the place’s zone', () => {
		// The fixture's first hour is 09:00 in Asia/Ho_Chi_Minh (UTC+7), so the
		// instant is 02:00 UTC. Parsed as though it were the viewer's local time,
		// the whole chart slides by the offset difference — and lines up exactly
		// for anyone testing from Hanoi.
		const points = hourlyPoints(WEATHER_PAYLOAD, 0, 3);

		expect(points).toHaveLength(3);
		expect(points[0]?.at).toBe(Date.UTC(2026, 7, 28, 2, 0));
		expect(points[1]?.at).toBe(Date.UTC(2026, 7, 28, 3, 0));
	});

	it('keeps a gap as null rather than dropping the hour', () => {
		// Dropping it would join the line across the missing hour, which is the
		// one thing doc 10 §2 says a gap must not become.
		const points = hourlyPoints(WEATHER_PAYLOAD, 0, 4);

		expect(points).toHaveLength(4);
		expect(points[3]).toMatchObject({ tempC: null, precipProb: null });
		expect(Number.isFinite(points[3]?.at)).toBe(true);
	});

	it('drops an hour whose stamp cannot be read at all', () => {
		// A row with a broken `t` has no place on a time axis; NaN there is a
		// point echarts draws at the epoch.
		const broken: TpWeatherPayload = {
			...WEATHER_PAYLOAD,
			hourly: [{ ...WEATHER_PAYLOAD.hourly[0]!, t: 'not a time' }, WEATHER_PAYLOAD.hourly[1]!]
		};
		const points = hourlyPoints(broken, 0, 4);

		expect(points).toHaveLength(1);
		expect(Number.isFinite(points[0]?.at)).toBe(true);
	});

	it('stops at the end of the window rather than wrapping', () => {
		expect(hourlyPoints(WEATHER_PAYLOAD, 2, 24)).toHaveLength(2);
	});
});

describe('readSettings', () => {
	it('reads a stored place and re-rounds it', () => {
		expect(
			readSettings({ place: { name: 'Hà Nội', lat: 21.028511, lon: 105.804817 } }).place
		).toEqual({ name: 'Hà Nội', lat: 21.03, lon: 105.8 });
	});

	it('falls back to no place for anything malformed', () => {
		// Fail-closed: a hand-edited layout lands on the picker, never on a crash.
		expect(readSettings({}).place).toBeNull();
		expect(readSettings({ place: null }).place).toBeNull();
		expect(readSettings({ place: { name: 'x', lat: 'north', lon: 0 } }).place).toBeNull();
		expect(readSettings({ place: { lat: 1, lon: 2 } }).place).toBeNull();
		expect(readSettings({ place: { name: 'x', lat: Number.NaN, lon: 2 } }).place).toBeNull();
	});

	it('defaults useMyLocation to false and keeps a stored boolean', () => {
		expect(readSettings({}).useMyLocation).toBe(false);
		expect(readSettings({ useMyLocation: 'yes' }).useMyLocation).toBe(false);
		expect(readSettings({ useMyLocation: true }).useMyLocation).toBe(true);
	});
});
