import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { StyleSpecification } from 'maplibre-gl';
import { settings } from '$lib/stores/settings.svelte';
import { loadMapLibre } from './maplibre';
import { mapStyleOverride } from './styles';
import TpMap, { type TpMapStatus } from './TpMap.svelte';

/**
 * The map component against the real MapLibre, loaded from its vendored copy
 * (the plugin's dev middleware serves it), with a style whose data is inline —
 * so a map draws in the test browser without a request to OpenFreeMap.
 */

const STYLE: StyleSpecification = {
	version: 8,
	sources: {},
	layers: [{ id: 'ground', type: 'background', paint: { 'background-color': 'rgb(11, 16, 22)' } }]
};

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	mapStyleOverride.set(STYLE);
});

afterEach(() => {
	cleanup();
	mapStyleOverride.reset();
	settings.dispose();
	vi.restoreAllMocks();
});

function mount(overrides: Record<string, unknown> = {}) {
	const statuses: TpMapStatus[] = [];
	const box = document.createElement('div');
	box.style.cssText = 'width: 400px; height: 300px;';
	document.body.appendChild(box);
	const screen = render(TpMap, {
		target: box,
		props: {
			lat: 21.0285,
			lon: 105.8542,
			zoom: 12,
			interactive: false,
			label: 'map around Hà Nội',
			onStatus: (status: TpMapStatus) => statuses.push(status),
			...overrides
		}
	});
	return { screen, statuses, box };
}

describe('TpMap', () => {
	it('draws, and says so', async () => {
		const { statuses } = mount();

		await vi.waitFor(() => expect(statuses.at(-1)).toBe('ready'), { timeout: 10_000 });
		expect(document.querySelector('[data-testid="map"] canvas')).not.toBeNull();
	});

	it('names the map region for a screen reader', async () => {
		const { screen } = mount();

		await expect
			.element(screen.getByRole('group', { name: 'map around Hà Nội' }))
			.toBeInTheDocument();
	});

	it('keeps the attribution out of compact mode, where it would fold away (doc 10 §8)', async () => {
		const { statuses } = mount();
		await vi.waitFor(() => expect(statuses.at(-1)).toBe('ready'), { timeout: 10_000 });

		const attribution = document.querySelector('.maplibregl-ctrl-attrib');
		expect(attribution).not.toBeNull();
		expect(attribution?.classList.contains('maplibregl-compact')).toBe(false);
	});

	it('puts pins on as elements whose names are text, never markup (rule 7)', async () => {
		const { statuses } = mount({
			pins: [
				{
					id: 'home',
					lat: 21.0285,
					lon: 105.8542,
					kind: 'home',
					label: '<img src=x onerror=alert(1)>'
				}
			]
		});
		await vi.waitFor(() => expect(statuses.at(-1)).toBe('ready'), { timeout: 10_000 });

		const pin = document.querySelector('.tp-map-pin--home');
		expect(pin?.getAttribute('aria-label')).toBe('<img src=x onerror=alert(1)>');
		expect(document.querySelector('.tp-map-pin--home img')).toBeNull();
	});

	it('makes pins buttons only on a map that is meant to be used', async () => {
		const onPin = vi.fn();
		const { statuses } = mount({
			interactive: true,
			onPin,
			pins: [{ id: 'p1', lat: 21.03, lon: 105.85, kind: 'saved', label: 'Văn Miếu' }]
		});
		await vi.waitFor(() => expect(statuses.at(-1)).toBe('ready'), { timeout: 10_000 });

		const pin = document.querySelector<HTMLButtonElement>('button.tp-map-pin');
		pin?.click();
		expect(onPin).toHaveBeenCalledWith('p1');
	});

	it('gives the WebGL context back when it goes (doc 08 §5)', async () => {
		const maplibre = await loadMapLibre();
		const remove = vi.spyOn(maplibre.Map.prototype, 'remove');
		const { statuses } = mount();
		await vi.waitFor(() => expect(statuses.at(-1)).toBe('ready'), { timeout: 10_000 });

		cleanup();

		expect(remove).toHaveBeenCalledOnce();
	});

	it('swaps the style when the theme changes, without a remount', async () => {
		const maplibre = await loadMapLibre();
		const setStyle = vi.spyOn(maplibre.Map.prototype, 'setStyle');
		const { statuses } = mount();
		await vi.waitFor(() => expect(statuses.at(-1)).toBe('ready'), { timeout: 10_000 });

		settings.patch({ theme: settings.resolvedTheme === 'dark' ? 'light' : 'dark' });

		await vi.waitFor(() => expect(setStyle).toHaveBeenCalled());
	});

	it('says no-webgl, and loads nothing, where WebGL2 is missing', async () => {
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

		const { statuses } = mount();

		await vi.waitFor(() => expect(statuses.at(-1)).toBe('no-webgl'));
		expect(document.querySelector('[data-testid="map"] canvas')).toBeNull();
	});
});
