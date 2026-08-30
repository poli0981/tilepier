import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpChart from './TpChart.svelte';
import { baseOption, type TpChartOption } from './options';

/**
 * The chart lifecycle owner. Everything here is about the wiring rather than
 * the picture: whether the module actually loads, whether the instance is
 * disposed, and — the one that would otherwise ship decorative — whether a
 * theme switch reaches a chart that is already drawn.
 */

const OPTION: TpChartOption = {
	...baseOption(),
	xAxis: { type: 'value' },
	yAxis: { type: 'value' },
	series: [{ type: 'line', data: [[0, 1] as [number, number], [1, 4] as [number, number]] }]
};

function props(overrides: Record<string, unknown> = {}) {
	return {
		option: OPTION,
		summary: 'a line from 1 to 4',
		loadingLabel: 'drawing',
		failedLabel: 'could not draw',
		...overrides
	};
}

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
});

afterEach(() => {
	cleanup();
	settings.dispose();
	vi.restoreAllMocks();
});

describe('the chart', () => {
	it('draws onto a canvas once the lazy chunk arrives', async () => {
		const screen = render(TpChart, props());
		const host = screen.getByTestId('chart-canvas');

		await expect.element(host).toBeInTheDocument();
		await vi.waitFor(() => {
			expect(host.element().querySelector('canvas')).not.toBeNull();
		});
	});

	it('pairs the canvas with the summary line doc 13 §8 asks for', async () => {
		const screen = render(TpChart, props());
		await expect
			.element(screen.getByTestId('chart-summary'))
			.toHaveTextContent('a line from 1 to 4');
	});

	it('takes an explicit pixel height, so zrender never measures zero', async () => {
		// `.tp-detail__body` scrolls, so a percentage height resolves to nothing
		// and echarts initialises a chart it then warns about and draws wrong.
		const screen = render(TpChart, props({ height: 180 }));
		const host = screen.getByTestId('chart-canvas');

		await vi.waitFor(() => {
			expect(host.element().clientHeight).toBe(180);
		});
	});

	it('disposes the instance on unmount', async () => {
		const screen = render(TpChart, props());
		const host = screen.getByTestId('chart-canvas');
		await vi.waitFor(() => {
			expect(host.element().querySelector('canvas')).not.toBeNull();
		});

		const el = host.element();
		const { echarts } = await import('./echarts');
		expect(echarts.getInstanceByDom(el as HTMLElement)).toBeDefined();

		cleanup();

		// Asked of echarts' own registry rather than of the container attribute,
		// which dispose blanks rather than removes. A leaked instance keeps
		// redrawing on every window resize for the life of the tab.
		await vi.waitFor(() => {
			expect(echarts.getInstanceByDom(el as HTMLElement)).toBeUndefined();
		});
	});

	it('re-themes a drawn chart when the theme changes, without disposing it', async () => {
		// The assertion the whole colourless-option split exists for. `setTheme`
		// merges into the chart's *defaults*, so a colour left in the option would
		// outrank it — and the switch would run, log nothing, and change nothing.
		settings.patch({ theme: 'dark' });
		const screen = render(TpChart, props());
		const host = screen.getByTestId('chart-canvas');

		await vi.waitFor(() => {
			expect(host.element().querySelector('canvas')).not.toBeNull();
		});
		const before = host.element().getAttribute('_echarts_instance_');

		settings.patch({ accent: '#b48ce8' });

		await vi.waitFor(() => {
			// Same instance — re-themed, not re-created.
			expect(host.element().getAttribute('_echarts_instance_')).toBe(before);
		});
		expect(host.element().querySelector('canvas')).not.toBeNull();
	});
});
