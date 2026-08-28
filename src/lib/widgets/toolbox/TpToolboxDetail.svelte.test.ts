import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpToolboxDetail from './TpToolboxDetail.svelte';

/**
 * doc 07 §7's detail — the options the tile has no room for.
 *
 * Deliberately not a second copy of the tile's suite: what is checked here is
 * the surface that only exists at full width — the correction level, the
 * password option set, the contrast checker and the ramp.
 */

function props(bag: Record<string, unknown> = {}, onUpdateSettings = vi.fn()) {
	return { instanceId: 'wgt_tb', settings: bag, onUpdateSettings, close: vi.fn() };
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
	it('opens on the tab the tile was showing', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'color' }));
		await expect.element(screen.getByTestId('dtab-color')).toHaveAttribute('aria-selected', 'true');
	});

	it('writes a tab change back, so closing leaves the tile where the detail was', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(TpToolboxDetail, props({ tab: 'qr' }, onUpdateSettings));

		await screen.getByTestId('dtab-password').click();
		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalledWith({ tab: 'password' });
		});
	});
});

describe('the QR panel', () => {
	it('offers the four correction levels', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'qr' }));
		const select = (await screen.getByTestId('dqr-ecc').element()) as unknown as HTMLSelectElement;
		expect([...select.options].map((option) => option.value)).toEqual(['L', 'M', 'Q', 'H']);
	});

	it('re-encodes at a stronger level, which needs more modules', async () => {
		// Error correction costs capacity, so the same text at H is at least as
		// big as at L. Read off the canvas, since that is the only place the
		// version is visible from outside.
		const screen = render(TpToolboxDetail, props({ tab: 'qr' }));
		await screen.getByTestId('dqr-text').fill('https://tilepier.win/w/toolbox?i=wgt_abcdefgh');

		// Through `expect.element` first: `.element()` does not retry, and the
		// encoder arrives on a dynamic import.
		await expect.element(screen.getByTestId('dqr-canvas')).toBeInTheDocument();
		const canvas = (await screen
			.getByTestId('dqr-canvas')
			.element()) as unknown as HTMLCanvasElement;
		await vi.waitFor(() => {
			expect(canvas.width).toBeGreaterThan(0);
		});
		const atM = canvas.width;

		await screen.getByTestId('dqr-ecc').selectOptions('H');
		await vi.waitFor(() => {
			expect(canvas.width).toBeGreaterThan(atM);
		});
	});

	it('offers a download only once there is something to download', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'qr' }));
		await expect
			.element(screen.getByRole('button', { name: m['widget.toolbox.qr.download']() }))
			.not.toBeInTheDocument();

		await screen.getByTestId('dqr-text').fill('tilepier');
		await expect
			.element(screen.getByRole('button', { name: m['widget.toolbox.qr.download']() }))
			.toBeInTheDocument();
	});
});

describe('the password panel', () => {
	it('recomputes the entropy when a class is switched off', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'password' }));
		// 20 characters of the full 89-character set.
		await expect
			.element(screen.getByTestId('dpw-entropy'))
			.toHaveTextContent(m['widget.toolbox.password.entropy']({ bits: 130 }));

		await screen.getByRole('checkbox', { name: m['widget.toolbox.password.symbols']() }).click();
		// 62 characters now, so 20 × log2(62) ≈ 119.
		await expect
			.element(screen.getByTestId('dpw-entropy'))
			.toHaveTextContent(m['widget.toolbox.password.entropy']({ bits: 119 }));
	});

	it('refuses to generate with every class off, and says why', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'password' }));
		for (const label of ['lower', 'upper', 'digits', 'symbols'] as const) {
			// `exact`, because an accessible-name match is case-insensitive and
			// `a–z` would otherwise also find `A–Z`.
			await screen
				.getByRole('checkbox', { name: m[`widget.toolbox.password.${label}`](), exact: true })
				.click();
		}

		await expect
			.element(screen.getByText(m['widget.toolbox.password.no_classes']()))
			.toBeInTheDocument();
		await expect.element(screen.getByTestId('dpw-generate')).toBeDisabled();
	});

	it('generates at the length the slider says', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'password' }));
		await screen.getByTestId('dpw-length').fill('32');
		await screen.getByTestId('dpw-generate').click();

		const value = await screen.getByTestId('dpw-value').element();
		expect(value.textContent).toHaveLength(32);
	});

	it('says on the panel that nothing is stored', async () => {
		// doc 07 §7's rule, said where the value is rather than in a privacy page.
		const screen = render(TpToolboxDetail, props({ tab: 'password' }));
		await expect
			.element(screen.getByText(m['widget.toolbox.password.not_stored']()))
			.toBeInTheDocument();
	});
});

describe('the colour panel', () => {
	it('opens on the beacon against ink-900, and grades the pair', async () => {
		// Which is 10.63:1 — a real pair worth checking, and the reason those
		// two seeds carry a `tokens-audit-ignore`.
		const screen = render(TpToolboxDetail, props({ tab: 'color' }));
		await expect.element(screen.getByTestId('dcolor-ratio')).toHaveTextContent('10.63');
		await expect
			.element(screen.getByTestId('dcolor-ratio'))
			.toHaveTextContent(m['widget.toolbox.color.verdict_aaa']());
	});

	it('regrades when the comparison colour changes', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'color' }));
		// The beacon on white is 1.98:1 — below AA, and the panel has to say so
		// rather than keeping the previous verdict.
		await screen.getByTestId('dcolor-against').fill('#ffffff');
		await expect
			.element(screen.getByTestId('dcolor-ratio'))
			.toHaveTextContent(m['widget.toolbox.color.verdict_fail']());
	});

	it('says a half-typed hex is not a colour yet, rather than showing zeros', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'color' }));
		await screen.getByTestId('dcolor-hex').fill('#12');

		await expect.element(screen.getByText(m['widget.toolbox.color.invalid']())).toBeInTheDocument();
		await expect.element(screen.getByTestId('dcolor-ratio')).not.toBeInTheDocument();
	});

	it('shows all three formats of the same colour', async () => {
		const screen = render(TpToolboxDetail, props({ tab: 'color' }));
		// Scoped to the format list: the hex also appears under the ramp's
		// middle swatch, which is the same colour by construction.
		const formats = screen.container.querySelector('.tp-tbd__formats');
		expect(formats?.textContent).toContain('#46d5c8');
		expect(formats?.textContent).toContain('rgb(70 213 200)');
		expect(formats?.textContent).toContain('hsl(');
	});

	it('draws a five-step ramp, and picking from it records the colour', async () => {
		const onUpdateSettings = vi.fn();
		const screen = render(TpToolboxDetail, props({ tab: 'color' }, onUpdateSettings));

		const swatches = screen.container.querySelectorAll('.tp-tbd__ramp .tp-tbd__swatch');
		expect(swatches).toHaveLength(5);

		(swatches[0] as HTMLButtonElement).click();
		await vi.waitFor(() => {
			expect(onUpdateSettings).toHaveBeenCalled();
		});
		const patch = onUpdateSettings.mock.calls[0]?.[0] as { recentColors: string[] };
		expect(patch.recentColors[0]).toMatch(/^#[0-9a-f]{6}$/);
	});
});
