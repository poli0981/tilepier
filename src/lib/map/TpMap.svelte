<script lang="ts" module>
	/** What the map is doing, for the widget to render around it. */
	export type TpMapStatus = 'loading' | 'ready' | 'offline' | 'error' | 'no-webgl';

	/** A point to mark. The label is text — a geocoder's name is a stranger's
	 *  string, and it goes into an attribute, never into HTML (rule 7). */
	export interface TpMapPin {
		id: string;
		lat: number;
		lon: number;
		kind: 'home' | 'saved' | 'found';
		label: string;
	}

	/** What a detail can ask of the map it is showing. */
	export interface TpMapCamera {
		flyTo(lat: number, lon: number, zoom?: number): void;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
	import { logEntry } from '$lib/core/log-buffer';
	import { online } from '$lib/stores/online.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { loadMapLibre, webgl2Available, type TpMapLibre } from './maplibre';
	import { mapStyle } from './styles';
	import './maplibre.css';

	/**
	 * One MapLibre map, mounted and torn down with this component (doc 08 §5).
	 *
	 * **What it owns.** Loading MapLibre (not before WebGL2 is known to be there,
	 * so a browser without it never downloads 300 KB it cannot use), the style
	 * for the current theme — swapped live when the theme changes — the pins,
	 * and `map.remove()` on unmount, which is what gives the WebGL context back
	 * (doc 08 §5: "released on detail close").
	 *
	 * **What it leaves to the widget.** Every state but the map itself: this
	 * reports a status, and the tile or the detail renders the card for it —
	 * `no-webgl` as doc 08 §5's static fallback, `offline` and `error` when the
	 * style could not be fetched. A tile failing *after* the style loaded is
	 * MapLibre's to retry and is not a state: the map keeps what it has drawn.
	 *
	 * **The attribution is always on and never compact** (doc 10 §8). MapLibre's
	 * default folds it into an "i" as soon as the map moves, programmatic moves
	 * included; OpenMapTiles and OpenStreetMap require it on every render.
	 *
	 * **Pins are plain elements with token classes**, not MapLibre's default
	 * marker, whose colours are written into its SVG — out of reach of the theme
	 * and of `tokens:audit`.
	 */
	interface Props {
		lat: number;
		lon: number;
		zoom: number;
		/** A tile's map is a picture: no pan, no zoom, no keyboard stop. */
		interactive: boolean;
		/** The map region's accessible name. */
		label: string;
		pins?: readonly TpMapPin[];
		onStatus?: ((status: TpMapStatus) => void) | undefined;
		onPin?: ((id: string) => void) | undefined;
		/** Receives the camera once the map is ready, and `null` as it goes. */
		onCamera?: ((camera: TpMapCamera | null) => void) | undefined;
	}

	let {
		lat,
		lon,
		zoom,
		interactive,
		label,
		pins = [],
		onStatus = undefined,
		onPin = undefined,
		onCamera = undefined
	}: Props = $props();

	let container = $state<HTMLDivElement | null>(null);
	let status = $state<TpMapStatus>('loading');

	/** Plain, not state: nothing renders from them, and a proxied map would be
	 *  a proxy around a WebGL context. */
	let map: MapLibreMap | null = null;
	let library: TpMapLibre | null = null;
	let ready = false;
	/*
	 * A plain Map, not SvelteMap, as TpGrid's host map is and for its reason:
	 * this is bookkeeping for markers MapLibre owns, written from effects and
	 * read from nowhere that renders. Reactive, a write inside the pin effect
	 * would register as a dependency of that same effect and re-run it.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const markers = new Map<string, Marker>();

	const camera: TpMapCamera = {
		flyTo(toLat, toLon, toZoom) {
			// Non-essential, so a reader who asked for reduced motion gets a jump.
			map?.flyTo({ center: [toLon, toLat], zoom: toZoom ?? Math.max(map.getZoom(), 13) });
		}
	};

	$effect(() => {
		// Mounts the map once the container exists, and removes it with the
		// component. Everything else about the map is set by the effects below.
		const element = container;
		if (element === null) return;

		if (!webgl2Available()) {
			status = 'no-webgl';
			return;
		}

		let cancelled = false;

		untrack(() => {
			loadMapLibre()
				.then((maplibre) => {
					if (cancelled) return;
					library = maplibre;
					const created = new maplibre.Map({
						container: element,
						style: mapStyle(settings.resolvedTheme),
						center: [lon, lat],
						zoom,
						interactive,
						attributionControl: { compact: false }
					});
					map = created;

					created.on('load', () => {
						ready = true;
						status = 'ready';
						syncPins(pins);
						onCamera?.(camera);
					});
					created.on('error', (event) => {
						// Before `load`, the style itself failed and there is no map to
						// show. After it, one tile failed and MapLibre retries.
						if (ready) return;
						status = online.isOnline ? 'error' : 'offline';
						logEntry('warn', 'map style could not be loaded', {
							src: 'widget',
							error: event.error
						});
					});
				})
				.catch((error: unknown) => {
					if (cancelled) return;
					status = online.isOnline ? 'error' : 'offline';
					logEntry('error', 'maplibre could not be loaded', { src: 'widget', error });
				});
		});

		return () => {
			cancelled = true;
			onCamera?.(null);
			for (const marker of markers.values()) marker.remove();
			markers.clear();
			map?.remove();
			map = null;
			ready = false;
		};
	});

	$effect(() => {
		// The theme, live (doc 10 §6). Markers are elements, not layers, so a
		// new style keeps them.
		const style = mapStyle(settings.resolvedTheme);
		untrack(() => {
			if (map !== null && ready) map.setStyle(style);
		});
	});

	$effect(() => {
		// Where the map looks — for a tile, its home moving.
		const center: [number, number] = [lon, lat];
		const level = zoom;
		untrack(() => map?.jumpTo({ center, zoom: level }));
	});

	$effect(() => {
		const list = pins;
		untrack(() => syncPins(list));
	});

	$effect(() => {
		// Reports the status up, outside the tracking of whoever listens.
		const next = status;
		untrack(() => onStatus?.(next));
	});

	function syncPins(list: readonly TpMapPin[]): void {
		if (map === null || library === null || !ready) return;

		const wanted = new Set(list.map((pin) => pin.id));
		for (const [id, marker] of markers) {
			if (wanted.has(id)) continue;
			marker.remove();
			markers.delete(id);
		}

		for (const pin of list) {
			const existing = markers.get(pin.id);
			if (existing !== undefined) {
				existing.setLngLat([pin.lon, pin.lat]);
				dress(existing.getElement(), pin);
				continue;
			}
			const marker = new library.Marker({ element: pinElement(pin), anchor: 'center' })
				.setLngLat([pin.lon, pin.lat])
				.addTo(map);
			markers.set(pin.id, marker);
		}
	}

	function pinElement(pin: TpMapPin): HTMLElement {
		const element = document.createElement(interactive ? 'button' : 'span');
		if (element instanceof HTMLButtonElement) {
			element.type = 'button';
			element.addEventListener('click', (event) => {
				// Not a click on the map underneath.
				event.stopPropagation();
				onPin?.(pin.id);
			});
		}
		dress(element, pin);
		return element;
	}

	/** Class, name and tooltip — all attributes, so a stranger's name is text. */
	function dress(element: HTMLElement, pin: TpMapPin): void {
		element.className = `tp-map-pin tp-map-pin--${pin.kind}`;
		element.setAttribute('aria-label', pin.label);
		element.title = pin.label;
		element.dataset['pin'] = pin.id;
	}
</script>

<div class="tp-map" role="group" aria-label={label} data-status={status} data-testid="map">
	<div class="tp-map__canvas" bind:this={container}></div>
</div>

<style>
	.tp-map {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		border-radius: inherit;
		background: var(--color-ink-900);
	}

	.tp-map__canvas {
		position: absolute;
		inset: 0;
	}

	/* The pins are made by this component but added by MapLibre, outside
	   Svelte's scoping — hence `:global`, confined by `.tp-map`. */
	.tp-map :global(.tp-map-pin) {
		display: block;
		width: 0.875rem;
		height: 0.875rem;
		border: 2px solid var(--color-ink-950);
		border-radius: 999px;
		background: var(--color-fg-mute);
		box-shadow: 0 0 0 1px var(--color-fg-dim);
		cursor: default;
		padding: 0;
	}

	.tp-map :global(button.tp-map-pin) {
		cursor: pointer;
	}

	.tp-map :global(button.tp-map-pin:focus-visible) {
		outline: 2px solid var(--color-beacon);
		outline-offset: 2px;
	}

	.tp-map :global(.tp-map-pin--home) {
		width: 1rem;
		height: 1rem;
		background: var(--color-beacon);
	}

	.tp-map :global(.tp-map-pin--found) {
		background: var(--color-warn);
	}
</style>
