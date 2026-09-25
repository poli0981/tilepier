import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { StyleSpecification } from 'maplibre-gl';
import { GEOCODE_OK } from '$lib/core/__fixtures__/geocode';
import { haversineKm } from '$lib/core/geo-distance';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { fmtDistance } from '$lib/i18n/fmt';
import { loadMapLibre } from '$lib/map/maplibre';
import { mapStyleOverride } from '$lib/map/styles';
import { m } from '$lib/paraglide/messages';
import { online } from '$lib/stores/online.svelte';
import { settings } from '$lib/stores/settings.svelte';
import { places } from './places.svelte';
import TpMapDetail from './TpMapDetail.svelte';

/**
 * The map detail in the browser project: the real MapLibre on an inline
 * style, the place search answered from the geocode fixture, and a throwaway
 * Dexie for the saved places.
 */

const STYLE: StyleSpecification = {
	version: 8,
	sources: {},
	layers: [{ id: 'ground', type: 'background', paint: { 'background-color': 'rgb(11, 16, 22)' } }]
};

const HOME = { name: 'Hoàn Kiếm', lat: 21.028511, lon: 105.852401 };

let db: TpDb;

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	settings.patch({ locale: 'vi' });
	online.reset();
	places.reset();
	mapStyleOverride.set(STYLE);
	db = createDb(`tilepier-mapd-${crypto.randomUUID()}`);
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async () =>
				new Response(JSON.stringify(GEOCODE_OK), {
					headers: { 'content-type': 'application/json' }
				})
		)
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

function show(over: Record<string, unknown> = {}) {
	const box = document.createElement('div');
	box.style.cssText = 'width: 1000px; height: 640px;';
	document.body.appendChild(box);
	return render(TpMapDetail, {
		target: box,
		props: { instanceId: 'wgt_map', settings: { home: HOME }, close: () => undefined, db, ...over }
	});
}

async function find(screen: ReturnType<typeof render>, name: string): Promise<void> {
	await screen.getByTestId('place-search').fill('hà n');
	await screen.getByText(name).click();
	await expect.element(screen.getByTestId('mapd-found')).toBeInTheDocument();
}

describe('search → save (doc 08 §5)', () => {
	it('saves what was found, under the name the reader gave it', async () => {
		const screen = show();

		await find(screen, 'Hà Nam');
		await screen.getByLabelText(m['widget.map.name_label']()).fill('Quê ngoại');
		await screen.getByTestId('mapd-save').click();

		await vi.waitFor(async () => {
			const rows = await db.savedPlaces.toArray();
			expect(rows).toMatchObject([{ name: 'Quê ngoại', lat: 20.5417, lon: 105.9229 }]);
		});
		await expect.element(screen.getByTestId('mapd-saved')).toHaveTextContent('Quê ngoại');
	});

	it('says how far each saved place is from home, nearest first', async () => {
		await db.savedPlaces.bulkPut([
			{ id: 'far', name: 'Hạ Long', lat: 20.9101, lon: 107.1839 },
			{ id: 'near', name: 'Văn Miếu', lat: 21.0277, lon: 105.8355 }
		]);
		const screen = show();

		const list = screen.getByTestId('mapd-saved');
		await expect.element(list).toHaveTextContent('Văn Miếu');
		const names = [...document.querySelectorAll('.tp-mapd__place-name')].map(
			(node) => node.textContent
		);
		expect(names.slice(1)).toEqual(['Văn Miếu', 'Hạ Long']);
		// Through the reader's own number format — "1,8 km" in Vietnamese.
		const km = haversineKm(HOME, { lat: 21.0277, lon: 105.8355 });
		expect(fmtDistance(km, 'vi')).toBe('1,8 km');
		await expect
			.element(list)
			.toHaveTextContent(m['widget.map.distance']({ distance: fmtDistance(km, 'vi') }));
	});

	it('makes a found place home, at the precision it was found', async () => {
		const onUpdateSettings = vi.fn();
		const screen = show({ onUpdateSettings });

		await find(screen, 'Hà Nam');
		await screen.getByRole('button', { name: m['widget.map.make_home']() }).click();

		expect(onUpdateSettings).toHaveBeenCalledWith({
			home: { name: 'Hà Nam', lat: 20.5417, lon: 105.9229 },
			useMyLocation: false
		});
	});
});

describe('a saved place', () => {
	beforeEach(async () => {
		await db.savedPlaces.put({ id: 'p1', name: 'Văn Miếu', lat: 21.0277, lon: 105.8355 });
	});

	it('renames in place', async () => {
		const screen = show();

		await screen
			.getByRole('button', { name: m['widget.map.rename']({ place: 'Văn Miếu' }) })
			.click();
		const box = screen.getByLabelText(m['widget.map.rename_label']({ place: 'Văn Miếu' }));
		await box.fill('Quốc Tử Giám');
		await box.click();
		(box.element() as HTMLInputElement).dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
		);

		await vi.waitFor(async () =>
			expect((await db.savedPlaces.get('p1'))?.name).toBe('Quốc Tử Giám')
		);
	});

	it('is removed', async () => {
		const screen = show();

		await screen
			.getByRole('button', { name: m['widget.map.remove']({ place: 'Văn Miếu' }) })
			.click();

		await vi.waitFor(async () => expect(await db.savedPlaces.count()).toBe(0));
		await expect.element(screen.getByText(m['widget.map.saved_none']())).toBeInTheDocument();
	});

	it('copies its coordinates as other apps read them, and says so', async () => {
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
		const screen = show();

		await screen
			.getByRole('button', { name: /Văn Miếu/ })
			.first()
			.click();
		await screen
			.getByRole('button', { name: m['widget.map.copy_label']({ place: 'Văn Miếu' }) })
			.click();

		expect(writeText).toHaveBeenCalledWith('21.02770, 105.83550');
		await expect.element(screen.getByText(m['widget.map.copied']())).toBeInTheDocument();
	});

	it('links out to OpenStreetMap and Google Maps with no way back', async () => {
		const screen = show();

		await screen
			.getByRole('button', { name: /Văn Miếu/ })
			.first()
			.click();

		const osm = screen.getByRole('link', { name: m['widget.map.open_osm']() }).last();
		await expect.element(osm).toHaveAttribute('rel', 'noopener noreferrer');
		await expect
			.element(osm)
			.toHaveAttribute(
				'href',
				expect.stringMatching(/openstreetmap\.org\/\?mlat=21\.0277&mlon=105\.8355/)
			);
		const google = screen.getByRole('link', { name: m['widget.map.open_google']() }).last();
		await expect.element(google).toHaveAttribute('target', '_blank');
	});
});

describe('closing it', () => {
	it('removes the map, which gives the WebGL context back (doc 08 §5)', async () => {
		const maplibre = await loadMapLibre();
		const remove = vi.spyOn(maplibre.Map.prototype, 'remove');
		show();
		await vi.waitFor(
			() =>
				expect(document.querySelector('[data-testid="map"]')?.getAttribute('data-status')).toBe(
					'ready'
				),
			{
				timeout: 10_000
			}
		);

		cleanup();

		expect(remove).toHaveBeenCalledOnce();
	});
});
