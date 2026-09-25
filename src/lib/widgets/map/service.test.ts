import { describe, expect, it } from 'vitest';
import manifest from './manifest';
import {
	coordinateText,
	isPoint,
	placeLabel,
	placeRows,
	PLACE_NAME_MAX,
	readPlace,
	readSettings
} from './service';

const HOAN_KIEM = { name: 'Hoàn Kiếm', lat: 21.028511, lon: 105.852401 };

describe('the manifest (doc 06 §7)', () => {
	it('declares geolocation, which makes permission-needed required (doc 06 §3)', () => {
		expect(manifest.permissions).toEqual(['geolocation']);
		expect(manifest.refresh).toBeUndefined();
	});
});

describe('readSettings', () => {
	it('starts with no home', () => {
		expect(readSettings({})).toEqual({ home: null, useMyLocation: false });
	});

	it('keeps a searched home at the geocoder’s precision — a place, not a person (plan S6)', () => {
		expect(readSettings({ home: HOAN_KIEM }).home).toEqual(HOAN_KIEM);
	});

	it('holds a located home to 2 dp however the layout was edited (doc 16 §3)', () => {
		const { home, useMyLocation } = readSettings({
			home: { name: '', lat: 21.028511, lon: 105.852401 },
			useMyLocation: true
		});

		expect(home).toEqual({ name: '', lat: 21.03, lon: 105.85 });
		expect(useMyLocation).toBe(true);
	});

	it('does not claim "my location" for a named home', () => {
		expect(readSettings({ home: HOAN_KIEM, useMyLocation: true }).useMyLocation).toBe(false);
	});

	it('reads a home that is not a real point as none', () => {
		for (const home of [
			{ name: 'x', lat: 91, lon: 0 },
			{ name: 'x', lat: 0, lon: 181 },
			{ name: 'x', lat: Number.NaN, lon: 0 },
			{ name: 'x', lat: '21', lon: '105' },
			'Hà Nội',
			null
		]) {
			expect(readSettings({ home }).home, JSON.stringify(home)).toBeNull();
		}
	});

	it('trims a name, and treats a non-string one as none', () => {
		expect(readSettings({ home: { ...HOAN_KIEM, name: '  Nhà  ' } }).home?.name).toBe('Nhà');
		expect(readSettings({ home: { ...HOAN_KIEM, name: 42 } }).home?.name).toBe('');
	});
});

describe('saved places read back from storage', () => {
	it('keeps a well-formed row', () => {
		expect(readPlace({ id: 'p1', name: 'Hồ Gươm', lat: 21.0287, lon: 105.8524 })).toEqual({
			id: 'p1',
			name: 'Hồ Gươm',
			lat: 21.0287,
			lon: 105.8524
		});
	});

	it('drops what a restored backup could carry and MapLibre could not draw', () => {
		// The importer checks only that each row is an object with an id.
		for (const row of [
			{ id: 'p', name: 'x', lat: 'abc', lon: 0 },
			{ id: 'p', name: 'x', lat: 0, lon: Infinity },
			{ id: '', name: 'x', lat: 0, lon: 0 },
			{ name: 'x', lat: 0, lon: 0 },
			null
		]) {
			expect(readPlace(row), JSON.stringify(row)).toBeNull();
		}
	});

	it('caps a name at the length a row can show', () => {
		const place = readPlace({ id: 'p', name: 'x'.repeat(500), lat: 0, lon: 0 });
		expect(place?.name).toHaveLength(PLACE_NAME_MAX);
	});

	it('labels an unnamed place by its coordinates', () => {
		expect(placeLabel({ name: ' ', lat: 21.0287, lon: 105.8524 })).toBe('21.02870, 105.85240');
	});
});

describe('coordinates as text', () => {
	it('uses five decimals and a dot in every locale, which other apps parse', () => {
		expect(coordinateText(21.028511, 105.852401)).toBe('21.02851, 105.85240');
		expect(coordinateText(-33.8688, 151.2093)).toBe('-33.86880, 151.20930');
	});

	it('knows a point when it sees one', () => {
		expect(isPoint({ lat: 0, lon: 0 })).toBe(true);
		expect(isPoint({ lat: -90, lon: 180 })).toBe(true);
		expect(isPoint({ lat: 0 })).toBe(false);
	});
});

describe('the saved list (doc 08 §5)', () => {
	const near = { id: 'near', name: 'Văn Miếu', lat: 21.0277, lon: 105.8355 };
	const far = { id: 'far', name: 'Hạ Long', lat: 20.9101, lon: 107.1839 };
	const alsoNear = { id: 'also', name: 'Bảo tàng', lat: 21.0277, lon: 105.8355 };

	it('puts the nearest to home first', () => {
		const rows = placeRows([far, near], HOAN_KIEM, 'vi');

		expect(rows.map((row) => row.place.id)).toEqual(['near', 'far']);
		expect(rows[0]?.km).toBeGreaterThan(1.5);
		expect(rows[0]?.km).toBeLessThan(2.5);
	});

	it('breaks a tie by name, in the reader’s collation', () => {
		expect(placeRows([near, alsoNear], HOAN_KIEM, 'vi').map((row) => row.place.id)).toEqual([
			'also',
			'near'
		]);
	});

	it('orders by name, with no distances, when there is no home', () => {
		const rows = placeRows([near, far], null, 'vi');

		expect(rows.map((row) => row.place.id)).toEqual(['far', 'near']);
		expect(rows.every((row) => row.km === null)).toBe(true);
	});
});
