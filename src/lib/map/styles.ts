import type { StyleSpecification } from 'maplibre-gl';

/**
 * The map's styles: OpenFreeMap's, one per app theme (doc 10 §6).
 *
 * **The style follows the theme; there is no toggle.** The Week 6 plan priced a
 * manual one (M8) and the owner cut it: a map that disagrees with the page it
 * sits in is a setting nobody asked for.
 *
 * Everything a style pulls in — TileJSON, vector and raster tiles, sprites,
 * glyphs — comes from `tiles.openfreemap.org`, the one map host doc 15 §2's
 * CSP allows and the only external request the app makes on the reader's own
 * behalf (CLAUDE.md rule 2). Measured 2026-09-25: the attribution a style
 * shows comes from OpenFreeMap's TileJSON, and it names OpenMapTiles and
 * OpenStreetMap as their licences require (doc 16 §5).
 */

const OFM = 'https://tiles.openfreemap.org/styles';

const MAP_STYLES = {
	light: `${OFM}/liberty`,
	dark: `${OFM}/dark`
} as const;

let override: StyleSpecification | null = null;

/** The style for a theme — or, in a test, the fixture it set. */
export function mapStyle(theme: 'light' | 'dark'): string | StyleSpecification {
	return override ?? MAP_STYLES[theme];
}

/**
 * Test seam: a style with its data inline, so a component test draws a map
 * without a request to OpenFreeMap. Never called in production. (The e2e
 * serves fixtures through `page.route` instead, which sees the worker's
 * requests too — doc 22 §S6.)
 */
export const mapStyleOverride = {
	set(style: StyleSpecification): void {
		override = style;
	},
	reset(): void {
		override = null;
	}
};

/** The OpenStreetMap page for a point — doc 08 §5's first external link. */
export function osmUrl(lat: number, lon: number, zoom = 16): string {
	const at = `${String(lat)}/${String(lon)}`;
	return `https://www.openstreetmap.org/?mlat=${String(lat)}&mlon=${String(lon)}#map=${String(zoom)}/${at}`;
}

/** The Google Maps search for a point — doc 08 §5's second external link. */
export function googleMapsUrl(lat: number, lon: number): string {
	return `https://www.google.com/maps/search/?api=1&query=${String(lat)},${String(lon)}`;
}
