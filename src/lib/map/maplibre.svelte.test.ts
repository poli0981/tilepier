import { describe, expect, it } from 'vitest';
import { loadMapLibre, webgl2Available } from './maplibre';

/**
 * Browser project, against the real files: the vendor plugin's dev middleware
 * serves MapLibre's copies at the same URL the build writes them to, so this
 * loads what production loads (doc 22 §S6).
 */

describe('loadMapLibre', () => {
	it('loads MapLibre 6 from its vendored copy, same-origin', async () => {
		const maplibre = await loadMapLibre();

		expect(typeof maplibre.Map).toBe('function');
		expect(maplibre.getVersion()).toMatch(/^6\./);
		expect(__TP_MAPLIBRE__).toMatch(/^\/_app\/immutable\/maplibre-6\.[\d.]+\/maplibre-gl\.mjs$/);
	});

	it('loads it once per page', async () => {
		expect(loadMapLibre()).toBe(loadMapLibre());
		await loadMapLibre();
	});
});

describe('webgl2Available', () => {
	it('finds WebGL2 in the test browser, which the map specs rely on', () => {
		expect(webgl2Available()).toBe(true);
	});
});
