<script lang="ts">
	// MapLibre's own stylesheet, bundled: the modules are vendored, the CSS is not.
	import 'maplibre-gl/dist/maplibre-gl.css';
	/**
	 * Spike S4 harness — doc 22 §S4.
	 *
	 * Its only job is to make the heavy libraries land in real lazy chunks so
	 * `pnpm budgets` measures something true. Every import below is a `() =>
	 * import()` thunk behind a user action, mirroring the manifest contract in
	 * doc 06 §1 — measuring a statically-imported bundle would tell us nothing
	 * about the shape the product actually ships.
	 */
	let log = $state<string[]>([]);
	let busy = $state(false);

	function note(line: string) {
		log = [...log, line];
	}

	async function loadCharts() {
		busy = true;
		try {
			const { createChart } = await import('$lib/charts/echarts');
			const { baseOption } = await import('$lib/charts/options');
			const { chartTheme, readChartTokens } = await import('$lib/charts/theme');
			const el = document.getElementById('s4-chart');
			if (!el) return;
			const chart = createChart(el);
			// Option first, then theme — `setTheme` early-returns while the chart
			// has no model. The harness follows `TpChart.svelte`'s order because
			// this route is what measures the shipped chunk.
			chart.setOption({
				...baseOption(),
				xAxis: { type: 'time' },
				yAxis: { type: 'value' },
				series: [
					{
						type: 'line',
						data: Array.from({ length: 40 }, (_, i) => [
							Date.now() + i * 3.6e6,
							Math.sin(i / 4) * 10 + 20
						])
					},
					{
						type: 'bar',
						data: Array.from({ length: 40 }, (_, i) => [Date.now() + i * 3.6e6, (i % 7) * 2])
					}
				]
			});
			chart.setTheme(chartTheme(readChartTokens()));
			note('echarts: chart rendered');
		} finally {
			busy = false;
		}
	}

	/**
	 * Week 6 spike M0 (doc 22 §S6): not "the module loaded" but **a map drew**.
	 *
	 * Until M0 this imported `maplibre-gl` through the bundler and checked that
	 * `Map` was a function — which passed while the worker the module asks for
	 * at runtime was never built. The style below needs no network, and its
	 * GeoJSON is cut into tiles by the worker, so `idle` is only reached if the
	 * worker loaded, ran under the CSP, and answered.
	 */
	async function loadMap() {
		busy = true;
		try {
			const { loadMapLibre, webgl2Available } = await import('$lib/map/maplibre');
			if (!webgl2Available()) {
				note('maplibre: no webgl2');
				return;
			}
			const maplibre = await loadMapLibre();
			const container = document.getElementById('s4-map');
			if (!container) return;

			const map = new maplibre.Map({
				container,
				center: [105.85, 21.03],
				zoom: 9,
				attributionControl: false,
				// So the e2e can read the pixels back after the frame is presented.
				canvasContextAttributes: { preserveDrawingBuffer: true },
				style: {
					version: 8,
					sources: {
						patch: {
							type: 'geojson',
							data: {
								type: 'Feature',
								properties: {},
								geometry: {
									type: 'Polygon',
									coordinates: [
										[
											[105.7, 20.9],
											[106.0, 20.9],
											[106.0, 21.2],
											[105.7, 21.2],
											[105.7, 20.9]
										]
									]
								}
							}
						}
					},
					layers: [
						{ id: 'ground', type: 'background', paint: { 'background-color': 'rgb(11, 16, 22)' } },
						{
							id: 'patch',
							type: 'fill',
							source: 'patch',
							paint: { 'fill-color': 'rgb(70, 213, 200)' }
						}
					]
				}
			});
			map.once('idle', () => note(`maplibre ${maplibre.getVersion()}: map rendered`));
			map.on('error', (event) => note(`maplibre: error ${String(event.error)}`));
		} finally {
			busy = false;
		}
	}

	async function loadDb() {
		busy = true;
		try {
			const { default: Dexie } = await import('dexie');
			const db = new Dexie('tp_s4_probe');
			db.version(1).stores({ probe: 'id' });
			await db.open();
			await db.close();
			await Dexie.delete('tp_s4_probe');
			note('dexie: opened and deleted probe db');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Spike S4 — bundle budgets</title></svelte:head>

<main>
	<h1>Spike S4 — lazy chunk budgets</h1>
	<p>Each button pulls one heavy library through a dynamic import.</p>

	<div class="controls">
		<button type="button" data-testid="load-charts" disabled={busy} onclick={loadCharts}>
			echarts
		</button>
		<button type="button" data-testid="load-map" disabled={busy} onclick={loadMap}>maplibre</button>
		<button type="button" data-testid="load-db" disabled={busy} onclick={loadDb}>dexie</button>
	</div>

	<div id="s4-chart" class="chart"></div>
	<div id="s4-map" class="chart" data-testid="s4-map"></div>

	<ul data-testid="log">
		{#each log as line (line)}<li>{line}</li>{/each}
	</ul>
</main>

<style>
	main {
		max-width: 1100px;
		margin: 0 auto;
		padding: 1.5rem;
	}

	h1 {
		margin: 0 0 0.5rem;
		font-size: var(--text-md);
		font-weight: 600;
	}

	p {
		margin: 0 0 1rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.controls button {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
		color: var(--color-fg);
		font: inherit;
		font-size: var(--text-xs);
		padding: 0.4rem 0.9rem;
		min-height: 40px;
		cursor: pointer;
	}

	.chart {
		height: 260px;
		margin-bottom: 1rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-900);
	}

	ul {
		margin: 1rem 0 0;
		padding-left: 1.2rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}
</style>
