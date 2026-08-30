import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import TpChart from './TpChart.svelte';
import { baseOption } from './options';

/**
 * The one case that needs the chart module to be *unavailable*, which is a
 * file-level condition: `vi.mock` is hoisted and applies to everything in the
 * file, so it cannot sit beside the tests that need the real module.
 *
 * Worth a file of its own because doc 17 §6 is explicit — a failure is a
 * sentence, never an empty frame — and this is a real failure mode: the chart
 * chunk is a separate network request, and a reader who opens a detail while
 * their connection drops gets exactly this.
 */

// A factory that *throws* makes vitest itself error rather than producing a
// rejected import, so the module loads and its one export refuses instead. The
// component wraps the import and `createChart` in one try, so this reaches the
// same catch a failed chunk would.
vi.mock('./echarts', () => ({
	createChart: () => {
		throw new Error('chunk unavailable');
	}
}));

afterEach(() => {
	cleanup();
});

describe('when the chart module will not load', () => {
	it('renders a sentence rather than an empty frame', async () => {
		const screen = render(TpChart, {
			option: { ...baseOption(), series: [] },
			summary: 'nothing to show',
			loadingLabel: 'drawing',
			failedLabel: 'could not draw'
		});

		await expect.element(screen.getByTestId('chart-failed')).toHaveTextContent('could not draw');
		// And the summary stays: it is the reading, not a caption for the picture.
		await expect.element(screen.getByTestId('chart-summary')).toHaveTextContent('nothing to show');
	});
});
