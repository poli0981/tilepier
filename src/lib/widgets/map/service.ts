import { haversineKm } from '$lib/core/geo-distance';
import type { TpSavedPlace } from '$lib/core/storage/db';
import { roundCoord } from '$lib/shared-constants';
import type { TpMapHome, TpMapSettings } from './types';

/**
 * The map tile's decisions, pure (doc 08 §5), so the node project can test
 * them without WebGL.
 */

function isCoordinate(value: unknown, limit: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** A point this app would put on a map, or nothing. */
export function isPoint(value: unknown): value is { lat: number; lon: number } {
	if (typeof value !== 'object' || value === null) return false;
	const bag = value as Record<string, unknown>;
	return isCoordinate(bag['lat'], 90) && isCoordinate(bag['lon'], 180);
}

/**
 * Reads the tile's settings bag, failing closed (doc 05 §5): a home that is not
 * a real point is no home.
 *
 * **A located home is kept at 2 dp** — the reader's own position is coarse
 * before it leaves `core/geolocate` (doc 16 §3), and a hand-edited layout does
 * not get to make it precise again. A searched home keeps the geocoder's
 * precision: it is a public place, not a person (Week 6 plan S6).
 */
export function readSettings(bag: Record<string, unknown>): TpMapSettings {
	const stored = bag['home'];
	let home: TpMapHome | null = null;

	if (isPoint(stored)) {
		const name = (stored as { name?: unknown }).name;
		const label = typeof name === 'string' ? name.trim().slice(0, 120) : '';
		home =
			label === ''
				? { name: '', lat: roundCoord(stored.lat), lon: roundCoord(stored.lon) }
				: { name: label, lat: stored.lat, lon: stored.lon };
	}

	return {
		home,
		useMyLocation: home !== null && home.name === '' && bag['useMyLocation'] === true
	};
}

/* ────────────────────────────────────────────────────────── saved places */

/** A name long enough to be useful and short enough to fit a list row. */
export const PLACE_NAME_MAX = 80;

/**
 * A saved place read out of Dexie — or out of a restored backup, whose importer
 * checks only that each row is an object with an id (`storage/exporter.ts`).
 * A row with no real coordinates is dropped here, where it would otherwise
 * reach MapLibre as `NaN` and throw inside a render.
 */
export function readPlace(row: unknown): TpSavedPlace | null {
	if (!isPoint(row)) return null;
	const bag = row as Record<string, unknown>;
	const id = bag['id'];
	const name = bag['name'];
	if (typeof id !== 'string' || id === '') return null;
	return {
		id,
		name: typeof name === 'string' ? name.slice(0, PLACE_NAME_MAX) : '',
		lat: row.lat,
		lon: row.lon
	};
}

/** A saved place, named as the reader named it — or by its coordinates. */
export function placeLabel(place: { name: string; lat: number; lon: number }): string {
	const name = place.name.trim();
	return name === '' ? coordinateText(place.lat, place.lon) : name;
}

/**
 * Coordinates as text: five decimals (about a metre), a dot for the decimal
 * point in every locale. This is what "copy coordinates" puts on the clipboard,
 * and what other apps parse — a comma decimal would read as two numbers.
 */
export function coordinateText(lat: number, lon: number): string {
	return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export interface TpPlaceRow {
	place: TpSavedPlace;
	/** From home, when there is one. */
	km: number | null;
}

/**
 * The saved list: nearest to home first (doc 08 §5), then by name, so two
 * places at one distance — or every place, with no home — keep a stable order.
 */
export function placeRows(
	list: readonly TpSavedPlace[],
	home: TpMapHome | null,
	locale: string
): TpPlaceRow[] {
	const rows = list.map((place) => ({
		place,
		km: home === null ? null : haversineKm(home, place)
	}));
	const byName = new Intl.Collator(locale, { sensitivity: 'base' });
	return rows.sort(
		(a, b) => (a.km ?? 0) - (b.km ?? 0) || byName.compare(placeLabel(a.place), placeLabel(b.place))
	);
}
