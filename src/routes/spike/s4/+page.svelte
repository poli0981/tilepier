<script lang="ts">
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

	async function loadMap() {
		busy = true;
		try {
			const maplibre = await import('maplibre-gl');
			note(`maplibre: ${typeof maplibre.Map === 'function' ? 'loaded' : 'unexpected shape'}`);
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
