<script lang="ts">
	import { logEntry } from '$lib/core/log-buffer';
	import { settings } from '$lib/stores/settings.svelte';
	import type { TpChart } from './echarts';
	import type { TpChartOption } from './options';
	import { chartTheme, readChartTokens } from './theme';

	/**
	 * The lifecycle owner for every ECharts view in the app — init, theme,
	 * resize, dispose — so no detail has to re-implement any of it.
	 *
	 * **The import is inside**, deliberately. A detail can import this component
	 * statically while echarts still lands in its own lazy chunk, which is what
	 * keeps `scripts/budgets.json`'s `echarts` row measuring a real file (doc 20
	 * §6). A static `import` of `./echarts` anywhere would fold ~183 KB into
	 * whichever chunk did it, and the budget gate would fail with "matched no
	 * files" rather than with a size.
	 *
	 * **No literal text.** `pnpm i18n:audit` walks every `.svelte` file, and each
	 * string a reader can see therefore arrives as a prop, from the detail that
	 * owns the catalogue keys.
	 */
	interface Props {
		option: TpChartOption;
		/**
		 * doc 13 §8: every chart is paired with an accessible summary line. It is
		 * rendered, not visually hidden — at tile and panel sizes it doubles as
		 * the caption a sighted reader uses to read the axis.
		 */
		summary: string;
		/** The skeleton's label while the chunk loads, and the failure sentence. */
		loadingLabel: string;
		failedLabel: string;
		/** An explicit height in px. Not a percentage: the detail body scrolls, so
		 *  a percentage resolves to zero and zrender initialises a chart it then
		 *  warns about and draws at the wrong size. */
		height?: number;
	}

	let { option, summary, loadingLabel, failedLabel, height = 220 }: Props = $props();

	let host = $state<HTMLDivElement | null>(null);
	let chart: TpChart | null = null;
	let failed = $state(false);
	let ready = $state(false);

	/** doc 20 §7 asks for 150 ms. A trailing debounce, because the useful frame
	 *  is the one after the drag stops. */
	const RESIZE_DEBOUNCE_MS = 150;

	$effect(() => {
		const el = host;
		if (el === null) return;

		let disposed = false;
		let observer: ResizeObserver | null = null;
		let timer: ReturnType<typeof setTimeout> | null = null;

		void (async () => {
			try {
				const { createChart } = await import('./echarts');
				if (disposed) return;

				const instance = createChart(el);
				chart = instance;

				// Option first: `setTheme` early-returns while the chart has no
				// model, so theming before the first `setOption` silently does
				// nothing at all.
				instance.setOption(withMotion(option));
				instance.setTheme(chartTheme(readChartTokens()));
				ready = true;

				observer = new ResizeObserver(() => {
					if (timer !== null) clearTimeout(timer);
					timer = setTimeout(() => instance.resize(), RESIZE_DEBOUNCE_MS);
				});
				observer.observe(el);
			} catch (error) {
				if (disposed) return;
				failed = true;
				logEntry('warn', 'the chart module could not be loaded', { src: 'widget', error });
			}
		})();

		return () => {
			disposed = true;
			if (timer !== null) clearTimeout(timer);
			observer?.disconnect();
			chart?.dispose();
			chart = null;
			ready = false;
		};
	});

	// Re-applies the option when the caller changes it, and when motion changes.
	$effect(() => {
		const next = withMotion(option);
		if (chart !== null && ready) chart.setOption(next, { notMerge: true });
	});

	/**
	 * doc 12 §2: a theme switch re-themes without disposing. Reads
	 * `resolvedTheme` and `accent` so the effect re-runs on either — the accent
	 * is user-overridable and series-1 follows it.
	 *
	 * `queueMicrotask` because the root layout writes `data-theme` and
	 * `--color-beacon` from its own effect: read in the same flush, the tokens
	 * would still be the previous theme's.
	 */
	$effect(() => {
		void settings.resolvedTheme;
		void settings.accent;
		if (chart === null || !ready) return;

		queueMicrotask(() => {
			chart?.setTheme(chartTheme(readChartTokens()));
		});
	});

	/** Built here rather than in the template: `pnpm i18n:audit` reads a literal
	 *  in markup as a user-visible string, and a CSS unit is not one. */
	const heightCss = $derived(`${String(height)}px`);

	/** doc 12 §7: motion is a setting, not a constant. */
	function withMotion(next: TpChartOption): TpChartOption {
		return { ...next, animation: settings.motionOK };
	}
</script>

<figure class="tp-chart" style:--tp-chart-h={heightCss}>
	{#if failed}
		<p class="tp-chart__note" role="alert" data-testid="chart-failed">{failedLabel}</p>
	{:else}
		<div class="tp-chart__canvas" bind:this={host} data-testid="chart-canvas"></div>
		{#if !ready}
			<!-- doc 13 §7: a skeleton, never a spinner. The module is a real lazy
			     chunk, so this is a frame that actually happens. -->
			<div class="tp-chart__skeleton" aria-label={loadingLabel}></div>
		{/if}
	{/if}
	<figcaption data-testid="chart-summary">{summary}</figcaption>
</figure>

<style>
	.tp-chart {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		margin: 0;
	}

	.tp-chart__canvas {
		width: 100%;
		height: var(--tp-chart-h);
	}

	.tp-chart__skeleton {
		position: absolute;
		inset: 0 0 auto 0;
		height: var(--tp-chart-h);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-850);
	}

	@media (prefers-reduced-motion: no-preference) {
		.tp-chart__skeleton {
			animation: tp-chart-tide 1.6s ease-in-out infinite;
		}
	}

	@keyframes tp-chart-tide {
		0%,
		100% {
			opacity: 0.5;
		}
		50% {
			opacity: 1;
		}
	}

	.tp-chart__note {
		margin: 0;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	figcaption {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}
</style>
