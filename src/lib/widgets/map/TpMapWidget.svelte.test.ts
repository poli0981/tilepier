import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { StyleSpecification } from 'maplibre-gl';
import { GEOCODE_OK } from '$lib/core/__fixtures__/geocode';
import { createDb, type TpDb } from '$lib/core/storage/db';
import type { TpTileSize } from '$lib/core/types';
import { mapStyleOverride } from '$lib/map/styles';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { places } from './places.svelte';
import TpMapWidget from './TpMapWidget.svelte';

/**
 * The map tile in the browser project: a real MapLibre drawing an inline
 * style (no request to OpenFreeMap), a throwaway Dexie for the saved places,
 * and `fetch` stubbed for the place search.
 */

const STYLE: StyleSpecification = {
	version: 8,
	sources: {},
	layers: [{ id: 'ground', type: 'background', paint: { 'background-color': 'rgb(11, 16, 22)' } }]
};

const M: TpTileSize = { w: 4, h: 3, pxW: 440, pxH: 220, tier: 'M' };
const HOME = { name: 'Hoàn Kiếm', lat: 21.028511, lon: 105.852401 };

let db: TpDb;
let requests: string[];

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	online.reset();
	places.reset();
	mapStyleOverride.set(STYLE);
	db = createDb(`tilepier-map-${crypto.randomUUID()}`);
	requests = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string) => {
			requests.push(String(input));
			return new Response(JSON.stringify(GEOCODE_OK), {
				headers: { 'content-type': 'application/json' }
			});
		})
	);
});

afterEach(async () => {
	cleanup();
	mapStyleOverride.reset();
	places.reset();
	online.reset();
	settings.dispose();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	db.close();
	await db.delete();
});

function props(over: Record<string, unknown> = {}) {
	return { instanceId: 'wgt_map', settings: { home: HOME }, size: M, db, ...over };
}

/** A tile's content box: the map fills its parent, so the parent needs a size. */
function show(over: Record<string, unknown> = {}) {
	const box = document.createElement('div');
	box.style.cssText = `width: ${String(M.pxW)}px; height: ${String(M.pxH)}px;`;
	document.body.appendChild(box);
	return render(TpMapWidget, { target: box, props: props(over) });
}

describe('empty (doc 06 §3)', () => {
	it('says who draws the map before anything is asked of them', async () => {
		const screen = show({ settings: {} });

		await expect
			.element(screen.getByTestId('map-notice'))
			.toHaveTextContent(m['widget.map.privacy_notice']());
		// No map, so no style, no tiles, no request to OpenFreeMap at all.
		expect(document.querySelector('[data-testid="map"]')).toBeNull();
		expect(requests).toEqual([]);
	});

	it('sets home from a search, at the geocoder’s precision', async () => {
		const onUpdateSettings = vi.fn();
		const screen = show({ settings: {}, onUpdateSettings });

		await screen.getByTestId('place-search').fill('hà n');
		await screen.getByText('Hà Nam').click();

		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({
				home: { name: 'Hà Nam', lat: 20.5417, lon: 105.9229 },
				useMyLocation: false
			});
		});
	});
});

describe('ready', () => {
	it('draws the map around home, and opens the detail on a click', async () => {
		const onOpenDetail = vi.fn();
		const screen = show({ onOpenDetail });

		const open = screen.getByRole('button', { name: m['widget.map.open_map']() });
		await expect.element(open, { timeout: 10_000 }).toBeInTheDocument();
		await open.click();

		expect(onOpenDetail).toHaveBeenCalledOnce();
		expect(document.querySelector('.tp-map-pin--home')?.getAttribute('aria-label')).toBe(
			'Hoàn Kiếm'
		);
	});

	it('counts the saved places, and shows them on the map', async () => {
		await db.savedPlaces.bulkPut([
			{ id: 'a', name: 'Văn Miếu', lat: 21.0277, lon: 105.8355 },
			{ id: 'b', name: 'Hồ Tây', lat: 21.0583, lon: 105.8194 }
		]);
		const screen = show();

		await expect
			.element(screen.getByTestId('map-saved-count'))
			.toHaveTextContent(m['widget.map.saved_count']({ count: 2 }));
		expect(document.querySelectorAll('.tp-map-pin--saved')).toHaveLength(2);
	});
});

describe('without a map', () => {
	it('falls back to the coordinates and OpenStreetMap where WebGL2 is missing (doc 08 §5)', async () => {
		const real = HTMLCanvasElement.prototype.getContext;
		vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
			this: HTMLCanvasElement,
			kind: string,
			...rest: unknown[]
		) {
			if (kind === 'webgl2') return null;
			return (real as (...args: unknown[]) => unknown).call(this, kind, ...rest) as ReturnType<
				HTMLCanvasElement['getContext']
			>;
		} as HTMLCanvasElement['getContext']);

		const screen = show();

		const card = screen.getByTestId('map-fallback');
		await expect.element(card).toHaveAttribute('data-reason', 'no-webgl');
		await expect.element(card).toHaveTextContent('21.02851, 105.85240');
		await expect
			.element(screen.getByRole('link', { name: m['widget.map.open_osm']() }))
			.toHaveAttribute('rel', 'noopener noreferrer');
	});

	it('permission-needed: a located home the browser now refuses offers search instead', async () => {
		const screen = show({
			settings: { home: { name: '', lat: 21.03, lon: 105.85 }, useMyLocation: true },
			permissionSource: () => Promise.resolve('denied' as const)
		});

		await expect.element(screen.getByTestId('map-permission')).toBeInTheDocument();
		await expect.element(screen.getByTestId('place-search')).toBeInTheDocument();
	});
});
