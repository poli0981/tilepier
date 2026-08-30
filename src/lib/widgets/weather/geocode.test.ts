import { afterEach, describe, expect, it, vi } from 'vitest';
import { TpApiError } from '$lib/core/api';
import { GEOCODE_EMPTY, GEOCODE_OK, GEOCODE_PAYLOAD } from '$lib/core/__fixtures__/geocode';
import { roundCoord } from '$lib/shared-constants';
import {
	contextOf,
	dedupeResults,
	geocodeUrl,
	isSearchable,
	QUERY_MIN,
	searchPlaces
} from './geocode';
import { coarsePosition, type TpPositionSource } from './geolocate';

/**
 * The picker's logic, in the node project. A stubbed `fetch` rather than MSW
 * for the same reason `service.test.ts` uses one: `geocodeUrl` returns a
 * relative path, which is what a browser asks for and which undici cannot
 * parse without an origin.
 */

function stubFetch(body: unknown, init: ResponseInit = {}): ReturnType<typeof vi.fn> {
	const spy = vi.fn(
		async () =>
			new Response(JSON.stringify(body), {
				...init,
				headers: { 'content-type': 'application/json' }
			})
	);
	vi.stubGlobal('fetch', spy);
	return spy;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('the query gate', () => {
	it('matches the server’s minimum rather than guessing', () => {
		// Below it the endpoint answers BAD_REQUEST, which would reach the reader
		// as an error card for having typed one letter.
		expect(QUERY_MIN).toBe(2);
		expect(isSearchable('h')).toBe(false);
		expect(isSearchable('hà')).toBe(true);
	});

	it('does not count whitespace as typing', () => {
		expect(isSearchable('   ')).toBe(false);
		expect(isSearchable('  hà  ')).toBe(true);
	});
});

describe('geocodeUrl', () => {
	it('trims and encodes, and sends the locale as the language', () => {
		expect(geocodeUrl('  Hà Nội ', 'vi')).toBe('/api/geocode?q=H%C3%A0+N%E1%BB%99i&lang=vi');
		expect(geocodeUrl('Paris', 'en')).toBe('/api/geocode?q=Paris&lang=en');
	});
});

describe('searchPlaces', () => {
	it('returns the matches from the envelope, untouched', async () => {
		const spy = stubFetch(GEOCODE_OK);
		const found = await searchPlaces('hà n', 'vi', new AbortController().signal);

		expect(found.map((r) => r.name)).toEqual([
			'Hà Nội',
			'Hà Nam',
			'Ring Road 3 Expressway (Hanoi)',
			'Ring Road 3 Expressway (Hanoi)'
		]);
		expect(spy.mock.calls[0]?.[0]).toBe('/api/geocode?q=h%C3%A0+n&lang=vi');
	});

	it('treats zero results as an answer, not a failure', async () => {
		// doc 08 §1's zero-results state. Throwing here would put the reader on
		// an error card for a search that ran perfectly and found nothing.
		stubFetch(GEOCODE_EMPTY);
		await expect(searchPlaces('zzzz', 'vi', new AbortController().signal)).resolves.toEqual([]);
	});

	it('surfaces an envelope failure as a TpApiError', async () => {
		stubFetch({ ok: false, error: { code: 'UPSTREAM_DOWN' } }, { status: 503 });
		await expect(searchPlaces('hà n', 'vi', new AbortController().signal)).rejects.toThrowError(
			TpApiError
		);
	});

	it('carries the geocoder’s own precision, which is NOT 2 dp', async () => {
		// This asserted the opposite until 2026-08-30, and the fixture's tidy
		// coordinates let it pass. `parseCoords` rounds what a *request* carries;
		// `normalizePhoton` passes a geocoder's answer straight through, so
		// rounding is the picker's job at the moment it stores a place.
		stubFetch(GEOCODE_OK);
		const found = await searchPlaces('hà n', 'vi', new AbortController().signal);
		const first = found[0];

		expect(first?.lat).not.toBe(roundCoord(first?.lat ?? 0));
	});
});

describe('dedupeResults', () => {
	it('drops rows a reader could not tell apart', () => {
		// Photon answers a road query with one feature per segment, all sharing a
		// name and a display name. Production returned four for `Hà Nội`.
		const kept = dedupeResults(GEOCODE_PAYLOAD.results);

		expect(kept.map((r) => r.name)).toEqual(['Hà Nội', 'Hà Nam', 'Ring Road 3 Expressway (Hanoi)']);
	});

	it('keeps the first of a duplicate pair', () => {
		const kept = dedupeResults(GEOCODE_PAYLOAD.results);
		const road = kept.find((r) => r.name.startsWith('Ring Road'));

		expect(road?.lat).toBe(20.9808057);
	});

	it('keeps two places that share a name but not a context', () => {
		// The case the rule must not over-reach on: same name, different place.
		const kept = dedupeResults([
			{ name: 'Springfield', displayName: 'Springfield, Illinois', lat: 1, lon: 2, type: 'city' },
			{ name: 'Springfield', displayName: 'Springfield, Missouri', lat: 3, lon: 4, type: 'city' }
		]);

		expect(kept).toHaveLength(2);
	});

	it('leaves an empty list alone', () => {
		expect(dedupeResults([])).toEqual([]);
	});
});

describe('contextOf', () => {
	it('drops the name from the head of the display name', () => {
		expect(contextOf(GEOCODE_PAYLOAD.results[0]!)).toBe('Việt Nam');
	});

	it('keeps a display name that does not start with the name', () => {
		expect(
			contextOf({ name: 'Hà Nội', displayName: 'Thủ đô, Việt Nam', lat: 0, lon: 0, type: 'city' })
		).toBe('Thủ đô, Việt Nam');
	});

	it('is empty when there is nothing to add', () => {
		// Renders as no second line at all rather than as the name twice.
		expect(contextOf({ name: 'Paris', displayName: 'Paris', lat: 0, lon: 0, type: 'city' })).toBe(
			''
		);
		expect(contextOf({ name: 'Paris', displayName: '', lat: 0, lon: 0, type: 'city' })).toBe('');
	});
});

describe('coarsePosition', () => {
	it('rounds to 2 dp before the coordinate leaves the module', async () => {
		// doc 16 §3 / doc 15 §7. This is the only assertion that can catch the
		// violation: the Worker re-rounds on arrival, so a precise coordinate
		// would produce a byte-identical response and leak invisibly.
		const precise: TpPositionSource = () =>
			Promise.resolve({ coords: { latitude: 21.028511, longitude: 105.804817 } });

		await expect(coarsePosition(precise)).resolves.toEqual({ lat: 21.03, lon: 105.8 });
	});

	it('propagates a refusal rather than inventing a position', async () => {
		const denied: TpPositionSource = () => Promise.reject(new Error('User denied Geolocation'));
		await expect(coarsePosition(denied)).rejects.toThrow('User denied Geolocation');
	});
});
