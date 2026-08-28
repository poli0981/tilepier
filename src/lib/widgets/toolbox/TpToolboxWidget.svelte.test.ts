import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpToolboxWidget from './TpToolboxWidget.svelte';

/**
 * doc 07 §7's tile, and doc 06 §3's states for it.
 *
 * Message text is asserted through `m[...]()` for the reason the calendar's
 * suite records: Paraglide's locale and `settings.locale` are independent in a
 * component test.
 *
 * Nothing here asserts that a QR *scans* — no decoder is available and
 * `qr.test.ts` says as much. What the tile owes is that the canvas appears for
 * text, does not for nothing, and that the overflow case says so instead.
 */

const SIZE: TpTileSize = { w: 3, h: 2, pxW: 320, pxH: 160, tier: 'M' };

function props(bag: Record<string, unknown> = {}, onUpdateSettings = vi.fn()) {
	return { instanceId: 'wgt_tb', settings: bag, size: SIZE, onUpdateSettings };
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

describe('tabs', () => {
	it('opens on QR when nothing has been chosen', async () => {
		const screen = render(TpToolboxWidget, props());
		await expect.element(screen.getByTestId('tab-qr')).toHaveAttribute('aria-selected', 'true');
	});

	it('shows the last-used tab, which is what doc 07 §7 asks the tile to do', async () => {
		const screen = render(TpToolboxWidget, props({ tab: 'password' }));
		await expect
			.element(screen.getByTestId('tab-password'))
			.toHaveAttribute('aria-selected', 'true');
		await expect
			.element(screen.getByRole('button', { name: m['widget.toolbox.password.generate']() }))
			.toBeInTheDocument();
	});

	it('writes the tab back through onUpdateSettings, so the detail agrees', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(TpToolboxWidget, props({}, onUpdateSettings));

		await screen.getByTestId('tab-color').click();
		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({ tab: 'color' });
		});
	});
});

describe('the QR tab', () => {
	it('says what to do before anything is typed, rather than showing a blank', async () => {
		// doc 06 §3's `empty`: explains, and the input beside it is the action.
		const screen = render(TpToolboxWidget, props());
		await expect.element(screen.getByText(m['widget.toolbox.qr.empty']())).toBeInTheDocument();
	});

	it('draws a canvas once there is text', async () => {
		const screen = render(TpToolboxWidget, props());
		await screen.getByTestId('qr-text').fill('https://tilepier.win');

		await expect.element(screen.getByTestId('qr-canvas')).toBeInTheDocument();
	});

	it('sizes the canvas from the tile, with the quiet zone included', async () => {
		// A QR drawn edge to edge does not scan; the margin is part of the
		// symbol rather than padding around it.
		const screen = render(TpToolboxWidget, props());
		await screen.getByTestId('qr-text').fill('tilepier');

		const canvas = (await screen.getByTestId('qr-canvas').element()) as HTMLCanvasElement;
		await vi.waitFor(() => {
			expect(canvas.width).toBeGreaterThan(0);
		});
		expect(canvas.width).toBe(canvas.height);
		// 21 modules plus 8 of quiet zone is 29; at any integer scale the canvas
		// is a multiple of that.
		expect(canvas.width % 29).toBe(0);
	});

	it('says so when the text will not fit, and does not draw a stale code', async () => {
		const screen = render(TpToolboxWidget, props());
		await screen.getByTestId('qr-text').fill('a'.repeat(2000));

		await expect.element(screen.getByText(m['widget.toolbox.qr.too_long']())).toBeInTheDocument();
		await expect.element(screen.getByTestId('qr-canvas')).not.toBeInTheDocument();
	});

	it('encodes Vietnamese without complaining', async () => {
		const screen = render(TpToolboxWidget, props());
		await screen.getByTestId('qr-text').fill('Hà Nội — chào bạn');
		await expect.element(screen.getByTestId('qr-canvas')).toBeInTheDocument();
	});
});

describe('the password tab', () => {
	it('starts with nothing, because nothing has been generated', async () => {
		const screen = render(TpToolboxWidget, props({ tab: 'password' }));
		await expect.element(screen.getByText(m['widget.toolbox.password.none']())).toBeInTheDocument();
	});

	it('generates one of the default length on a press', async () => {
		const screen = render(TpToolboxWidget, props({ tab: 'password' }));
		await screen.getByTestId('password-generate').click();

		const value = await screen.getByTestId('password-value').element();
		expect(value.textContent).toHaveLength(20);
	});

	it('generates a different one each press', async () => {
		const screen = render(TpToolboxWidget, props({ tab: 'password' }));
		await screen.getByTestId('password-generate').click();
		const first = (await screen.getByTestId('password-value').element()).textContent;

		await screen.getByTestId('password-generate').click();
		const second = (await screen.getByTestId('password-value').element()).textContent;

		expect(first).not.toBe(second);
	});

	it('shows the entropy of the settings, not of the string', async () => {
		const screen = render(TpToolboxWidget, props({ tab: 'password' }));
		await expect
			.element(screen.getByText(m['widget.toolbox.password.entropy']({ bits: 130 })))
			.toBeInTheDocument();
	});

	it('never writes the generated value into settings', async () => {
		// doc 07 §7: a generated password is stored nowhere. The tile's only
		// write is the tab, and this is the assertion that keeps it that way.
		const onUpdateSettings = vi.fn();
		const screen = render(TpToolboxWidget, props({ tab: 'password' }, onUpdateSettings));
		await screen.getByTestId('password-generate').click();

		expect(onUpdateSettings).not.toHaveBeenCalled();
	});
});

describe('the colour tab', () => {
	it('says where colours will land before any have', async () => {
		const screen = render(TpToolboxWidget, props({ tab: 'color' }));
		await expect
			.element(screen.getByText(m['widget.toolbox.color.recent_empty']()))
			.toBeInTheDocument();
	});

	it('shows the picked colour as hex', async () => {
		const screen = render(TpToolboxWidget, props({ tab: 'color' }));
		await expect.element(screen.getByTestId('color-hex')).toHaveTextContent('#46d5c8');
	});

	it('renders the stored recents as swatches', async () => {
		const screen = render(TpToolboxWidget, props({ tab: 'color', recentColors: ['#112233'] }));
		await expect
			.element(
				screen.getByRole('button', { name: m['widget.toolbox.color.use']({ hex: '#112233' }) })
			)
			.toBeInTheDocument();
	});

	it('moves a re-picked swatch to the front rather than duplicating it', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(
			TpToolboxWidget,
			props({ tab: 'color', recentColors: ['#112233', '#445566'] }, onUpdateSettings)
		);

		await screen
			.getByRole('button', { name: m['widget.toolbox.color.use']({ hex: '#445566' }) })
			.click();

		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({
				recentColors: ['#445566', '#112233']
			});
		});
	});
});
