import type { TpApiMeta, TpMaybeNumber, TpWeatherHour, TpWeatherPayload } from '$lib/api-types';
import { fetchEnvelope } from '$lib/core/api';
import { swr, type TpSwrFetcher, type TpSwrHandle } from '$lib/core/swr.svelte';
import type { TpDb } from '$lib/core/storage/db';
import { zoneOffsetMinutes } from '$lib/i18n/fmt';
import { CACHE_POLICY, cacheKey, geohash, roundCoord } from '$lib/shared-constants';
import { WEATHER_DEFAULTS, type TpWeatherPlace, type TpWeatherSettings } from './types';

/**
 * The weather tile's data layer — and `swr()`'s first real caller anywhere in
 * the app (doc 23, "What Week 4 starts from", item 1).
 *
 * Pure but for `weatherSource`, so everything the tile decides can be tested in
 * the node project without a DOM.
 */

/**
 * What the tile subscribes to.
 *
 * `T` carries the envelope's `meta`, and that is a decision about the whole
 * tier-2 pattern rather than about weather. `swr` computes its status from the
 * *client's* cache age alone, so a response the Worker served past its KV TTL
 * because upstream was down (`x-tp-cache: STALE`, doc 11 §4) arrives with a
 * fresh `cachedAt` and reads as `fresh`. The tile would show an hour-old
 * temperature as current, which is exactly what doc 04 §4's worked example says
 * must not happen — and `core/api.test.ts` already has a case named "carries
 * the stale flag through rather than swallowing it" that the first consumer
 * would then swallow.
 */
export interface TpWeatherReading {
	payload: TpWeatherPayload;
	meta: TpApiMeta;
}

/* ─────────────────────────────────────────────────────────────── the source */

/**
 * The data key, spelled the way the Worker spells it (doc 04 §5).
 *
 * Round, then hash — `shared-constants.test.ts` pins the order on both sides.
 * It is also the scheduler id (doc 04 §3): two tiles on the same place share
 * one entry, one request and one task, which is what "multi-instance
 * per-place" has to mean if it is not going to cost quota per tile.
 */
export function weatherKey(lat: number, lon: number): string {
	return cacheKey.weather(geohash(roundCoord(lat), roundCoord(lon)));
}

/** 2 dp in the query string too — the Worker re-rounds, but the coordinate
 *  must already be coarse when it leaves the device (doc 16 §3). */
export function weatherUrl(lat: number, lon: number): string {
	const params = new URLSearchParams({
		lat: String(roundCoord(lat)),
		lon: String(roundCoord(lon))
	});
	return `/api/weather?${params.toString()}`;
}

export function fetchWeather(lat: number, lon: number): TpSwrFetcher<TpWeatherReading> {
	return async (signal) => {
		const result = await fetchEnvelope<TpWeatherPayload>(weatherUrl(lat, lon), signal);
		return { payload: result.data, meta: result.meta };
	};
}

/**
 * Subscribe to one place.
 *
 * `target` is threaded through so a component test can drive a throwaway Dexie
 * rather than the reader's own, the way `swr.svelte.test.ts` does.
 */
export function weatherSource(
	lat: number,
	lon: number,
	target?: TpDb
): TpSwrHandle<TpWeatherReading> {
	const key = weatherKey(lat, lon);
	// doc 08 §1's "client ttl 600 s" is the same number as the Worker's KV TTL,
	// which is the floor doc 04 §2 requires — a client window shorter than the
	// edge's would revalidate into a guaranteed HIT.
	const options = { ttlMs: CACHE_POLICY.wx.ttlMs };

	return target === undefined
		? swr<TpWeatherReading>(key, fetchWeather(lat, lon), options)
		: swr<TpWeatherReading>(key, fetchWeather(lat, lon), options, target);
}

/* ──────────────────────────────────────────────────────────────── settings */

function isPlace(value: unknown): value is TpWeatherPlace {
	if (typeof value !== 'object' || value === null) return false;
	const bag = value as Record<string, unknown>;
	return (
		typeof bag['name'] === 'string' &&
		typeof bag['lat'] === 'number' &&
		Number.isFinite(bag['lat']) &&
		typeof bag['lon'] === 'number' &&
		Number.isFinite(bag['lon'])
	);
}

/** Fail-closed, in the style of `quote/service.ts` and `calendar/service.ts`:
 *  a settings bag hand-edited into the layout, or written by an older build,
 *  must land on the place picker rather than take the tile down. */
export function readSettings(bag: Record<string, unknown>): TpWeatherSettings {
	const place = bag['place'];
	return {
		place: isPlace(place)
			? { name: place.name, lat: roundCoord(place.lat), lon: roundCoord(place.lon) }
			: WEATHER_DEFAULTS.place,
		useMyLocation:
			typeof bag['useMyLocation'] === 'boolean'
				? bag['useMyLocation']
				: WEATHER_DEFAULTS.useMyLocation
	};
}

/* ───────────────────────────────────────────────────────────── reading rows */

/**
 * The one guard for a value upstream did not send.
 *
 * `Number.isFinite` and not `Number.isNaN`, because the gap `normalize.ts`
 * writes as `NaN` arrives at the client as `null` — `JSON.stringify(NaN)` is
 * `null`, and `_lib/respond.ts` is where that happens. `isNaN(null)` is false,
 * so a guard written the obvious way would let the gap straight through.
 * `isFinite` is false for both, and for `undefined` and `Infinity` as well.
 */
export function isGap(value: TpMaybeNumber | undefined): boolean {
	return typeof value !== 'number' || !Number.isFinite(value);
}

/**
 * Index of the hour that is "now" *at the place*, or `-1` when the payload has
 * nothing to show for it.
 *
 * `hourly[].t` is a local ISO string in `payload.place.timezone` with **no
 * offset** — `2026-08-28T09:00`. `new Date(t)` therefore parses it in the
 * viewer's zone, so a Hanoi forecast read from Berlin picks an hour five off,
 * and read from Hanoi picks the right one. That is the worst kind of bug: it is
 * correct for the person writing it, the person reviewing it, and the fixture.
 *
 * So the comparison happens the other way round — shift *now* into the place's
 * zone and compare wall clocks as strings, using the Intl-derived, DST-correct
 * `zoneOffsetMinutes` the clock widget already relies on.
 */
export function currentHourIndex(payload: TpWeatherPayload, now: number): number {
	const offsetMin = zoneOffsetMinutes(now, payload.place.timezone);
	// Wall clock at the place, in the spelling upstream uses, truncated to the
	// hour: `2026-08-28T09`.
	const stamp = new Date(now + offsetMin * 60_000).toISOString().slice(0, 13);

	const exact = payload.hourly.findIndex((hour) => hour.t.slice(0, 13) === stamp);
	if (exact !== -1) return exact;

	// A cached payload whose window has moved past "now" still holds hours worth
	// showing; fall back to the last one that is not in the future rather than
	// rendering nothing.
	let latest = -1;
	for (let i = 0; i < payload.hourly.length; i += 1) {
		const t = payload.hourly[i]?.t;
		if (t !== undefined && t.slice(0, 13) <= stamp) latest = i;
	}
	return latest;
}

export interface TpSparkline {
	/** One entry per unbroken run of readings. A gap ends a segment rather than
	 *  being interpolated across — doc 10 §2's whole point about `NaN`. */
	segments: readonly (readonly { readonly x: number; readonly y: number }[])[];
	minC: number;
	maxC: number;
	hours: number;
}

/**
 * The 12-hour temperature sparkline (doc 08 §1), as unit coordinates: `x` and
 * `y` both run 0…1, so the component picks the box and this stays testable in
 * the node project.
 *
 * `null` when there is nothing to draw — fewer than two finite readings, which
 * is a real state at the very end of a cached window rather than an error.
 */
export function sparklinePoints(
	payload: TpWeatherPayload,
	fromIndex: number,
	count: number
): TpSparkline | null {
	const start = Math.max(0, fromIndex);
	const rows: TpWeatherHour[] = payload.hourly.slice(start, start + count);
	if (rows.length < 2) return null;

	const finite = rows.map((row) => row.tempC).filter((t): t is number => !isGap(t));
	if (finite.length < 2) return null;

	const minC = Math.min(...finite);
	const maxC = Math.max(...finite);
	// A flat twelve hours is legal and would divide by zero; draw it mid-box.
	const span = maxC - minC || 1;
	const lastX = rows.length - 1;

	const segments: { x: number; y: number }[][] = [];
	let run: { x: number; y: number }[] = [];
	rows.forEach((row, i) => {
		const t = row.tempC;
		if (isGap(t)) {
			if (run.length > 0) segments.push(run);
			run = [];
			return;
		}
		run.push({ x: i / lastX, y: 1 - ((t as number) - minC) / span });
	});
	if (run.length > 0) segments.push(run);

	return { segments, minC, maxC, hours: rows.length };
}

/* ────────────────────────────────────────────────────────── the 24 h chart */

/** One hour, ready to plot: an epoch instant and the two series' values. */
export interface TpHourPoint {
	/** Epoch ms, resolved through the *place's* zone — see `currentHourIndex`. */
	at: number;
	tempC: number | null;
	precipProb: number | null;
	cloudPct: number | null;
}

/**
 * Turns a local ISO stamp into an instant.
 *
 * `hourly[].t` carries no offset, so `Date.parse` would read it in the viewer's
 * zone. Subtracting the place's offset is what makes a Hanoi forecast plot at
 * Hanoi's hours no matter where it is being read.
 */
function instantOf(localIso: string, offsetMin: number): number {
	// The shape is checked before the parse, because `Date.parse` is lenient
	// enough to return a number for strings that are not times at all — so a
	// `Number.isFinite` guard on its result catches nothing and the chart gets a
	// point somewhere near 1970.
	if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localIso)) return Number.NaN;

	// `Z` makes the parse explicit rather than implementation-defined, then the
	// offset moves it back to the real instant.
	const asUtc = Date.parse(`${localIso}:00Z`);
	return Number.isFinite(asUtc) ? asUtc - offsetMin * 60_000 : Number.NaN;
}

/**
 * `count` hours from `fromIndex`, as points a chart can take directly.
 *
 * Gaps become `null` rather than being dropped, so the line breaks at them
 * instead of drawing a straight segment across a missing hour — the same
 * contract the sparkline holds, and the reason doc 10 §2 refuses to substitute
 * a zero.
 */
export function hourlyPoints(
	payload: TpWeatherPayload,
	fromIndex: number,
	count: number
): TpHourPoint[] {
	const offsetMin = zoneOffsetMinutes(Date.now(), payload.place.timezone);
	const start = Math.max(0, fromIndex);

	return payload.hourly.slice(start, start + count).flatMap((row) => {
		const at = instantOf(row.t, offsetMin);
		if (!Number.isFinite(at)) return [];
		return [
			{
				at,
				tempC: isGap(row.tempC) ? null : (row.tempC as number),
				precipProb: isGap(row.precipProb) ? null : (row.precipProb as number),
				// Undefined rather than null for an entry cached before `cloud_cover`
				// was requested — the wx:v1 key did not change, so up to 24 h of
				// entries answer without the column. `isGap` is false for neither.
				cloudPct: isGap(row.cloudPct) ? null : (row.cloudPct as number)
			}
		];
	});
}

/** doc 08 §1's 24-hour window. */
export const CHART_HOURS = 24;
