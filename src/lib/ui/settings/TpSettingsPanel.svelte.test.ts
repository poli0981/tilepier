import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { LOCAL_KEYS } from '$lib/shared-constants';
import { deck } from '$lib/stores/deck.svelte';
import { settings } from '$lib/stores/settings.svelte';
import TpSettingsPanel from './TpSettingsPanel.svelte';

/**
 * doc 19 §1 names settings round-trips as a component-layer concern, and
 * doc 13 §10's "no save button" is exactly the sort of claim that is only true
 * if something checks it: every control has to write on interaction.
 */

function stored(): Record<string, unknown> | null {
	const raw = localStorage.getItem(LOCAL_KEYS.settings);
	return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	deck.dispose();
	deck.hydrate();
});

afterEach(() => {
	settings.dispose();
	deck.dispose();
	vi.restoreAllMocks();
});

describe('round-trips', () => {
	it('writes the theme on click, with no save step', async () => {
		const screen = render(TpSettingsPanel);

		await screen.getByTestId('theme-light').click();

		expect(settings.theme).toBe('light');
		expect(stored()?.['theme']).toBe('light');
	});

	it('writes the accent from a preset swatch', async () => {
		const screen = render(TpSettingsPanel);

		await screen.getByTestId('accent-7b8ff2').click();

		expect(settings.accent).toBe('#7b8ff2');
		expect(stored()?.['accent']).toBe('#7b8ff2');
	});

	it('writes reduced motion, and motionOK follows', async () => {
		const screen = render(TpSettingsPanel);

		await screen.getByTestId('motion-on').click();

		expect(settings.reducedMotion).toBe('on');
		expect(settings.motionOK).toBe(false);
	});

	it('toggles the 24-hour clock', async () => {
		const screen = render(TpSettingsPanel);

		await screen.getByTestId('clock24h').click();

		expect(settings.clock24h).toBe(false);
		expect(stored()?.['clock24h']).toBe(false);
	});

	it('reflects the stored value rather than a default', async () => {
		settings.patch({ theme: 'light' });
		const screen = render(TpSettingsPanel);

		await expect.element(screen.getByTestId('theme-light')).toHaveAttribute('aria-pressed', 'true');
		await expect.element(screen.getByTestId('theme-dark')).toHaveAttribute('aria-pressed', 'false');
	});
});

describe('deck', () => {
	it('restores the seeded layout', async () => {
		const screen = render(TpSettingsPanel);
		const seeded = deck.tiles.length;

		deck.add('clock');
		deck.add('clock');
		expect(deck.tiles.length).toBe(seeded + 2);

		await screen.getByTestId('reset-deck').click();

		// Back to whatever doc 13 §9's seed filters down to in this build, not to
		// a number that has to be re-edited each time a widget lands.
		expect(deck.tiles).toHaveLength(seeded);
	});
});

describe('erase', () => {
	it('takes two presses, so one stray click cannot wipe a device', async () => {
		const screen = render(TpSettingsPanel);

		await expect.element(screen.getByTestId('erase-confirm')).not.toBeInTheDocument();
		await screen.getByTestId('erase-data').click();
		await expect.element(screen.getByTestId('erase-confirm')).toBeVisible();
	});
});

describe('diagnostics', () => {
	it('is hidden until the flag is set (doc 18 §5)', async () => {
		const screen = render(TpSettingsPanel);

		await expect.element(screen.getByTestId('diagnostics')).not.toBeInTheDocument();
	});

	it('appears with the settings flag, no fourth localStorage key involved', async () => {
		settings.patch({ debug: true });
		const screen = render(TpSettingsPanel);

		await expect.element(screen.getByTestId('diagnostics')).toBeVisible();
		await expect.element(screen.getByText(m['settings.diagnostics.no_tasks']())).toBeVisible();
	});
});

describe('about', () => {
	it('shows the build stamped in at compile time', async () => {
		const screen = render(TpSettingsPanel);

		await expect.element(screen.getByTestId('build-info')).toBeVisible();
	});
});
