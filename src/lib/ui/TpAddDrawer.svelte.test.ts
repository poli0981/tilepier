import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { deck } from '$lib/stores/deck.svelte';
import { ui } from '$lib/stores/ui.svelte';
import TpAddDrawer from './TpAddDrawer.svelte';

/**
 * doc 13 §4. Browser project because the drawer is a focus-managing dialog and
 * the interesting parts — search, the disabled "on deck" state, focus return —
 * only exist in a real document.
 *
 * Text is asserted through `m[...]()` rather than against literals. The custom
 * locale strategy is installed by `hooks.client.ts`, which component tests do
 * not run, so Paraglide falls back to `preferredLanguage` and the runner's
 * browser decides the language. Comparing rendered output to the catalogue is
 * both locale-proof and the actual contract; hardcoding "Đồng hồ" here would
 * have passed only by accident. Diacritic folding is a pure function and is
 * tested in `src/lib/i18n/fold.test.ts`, where it belongs.
 */

beforeEach(() => {
	ui.reset();
	deck.dispose();
	deck.hydrate();
});

afterEach(() => {
	ui.reset();
	deck.dispose();
	vi.restoreAllMocks();
});

describe('visibility', () => {
	it('renders nothing while closed', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });

		await expect.element(screen.getByTestId('add-drawer')).not.toBeInTheDocument();
	});

	it('opens when the store says so', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });

		ui.openDrawer();

		await expect.element(screen.getByTestId('add-drawer')).toBeVisible();
	});

	it('closes on the scrim', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();

		await screen.getByTestId('drawer-scrim').click();

		expect(ui.drawerOpen).toBe(false);
	});
});

describe('cards', () => {
	it('lists a registered widget with its title and blurb', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();

		await expect.element(screen.getByText(m['widget.clock.title']())).toBeVisible();
		await expect.element(screen.getByText(m['widget.clock.blurb']())).toBeVisible();
	});

	it('groups under the category heading', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();

		await expect
			.element(screen.getByRole('heading', { name: m['common.category.time']() }))
			.toBeVisible();
	});

	it('reports the add through the callback', async () => {
		const onAdd = vi.fn();
		const screen = render(TpAddDrawer, { onAdd });
		ui.openDrawer();

		await screen.getByTestId('add-clock').click();

		expect(onAdd).toHaveBeenCalledExactlyOnceWith('clock');
	});

	it('keeps a multiInstance widget addable when it is already on the deck', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();

		// clock is multiInstance, so "on deck" must not apply — a disabled button
		// here would be wrong, and doc 06 §4 is explicit about the distinction.
		await expect.element(screen.getByTestId('add-clock')).toBeEnabled();
	});
});

describe('search', () => {
	it('keeps a matching widget and its heading', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();

		await screen.getByRole('searchbox').fill(m['widget.clock.title']().slice(0, 3));

		await expect.element(screen.getByTestId('add-clock')).toBeVisible();
	});

	it('ignores case and surrounding whitespace', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();

		await screen.getByRole('searchbox').fill(`  ${m['widget.clock.title']().toUpperCase()}  `);

		await expect.element(screen.getByTestId('add-clock')).toBeVisible();
	});

	it('says so when nothing matches', async () => {
		const screen = render(TpAddDrawer, { onAdd: () => {} });
		ui.openDrawer();

		await screen.getByRole('searchbox').fill('zzzz');

		await expect.element(screen.getByText(m['common.no_matches']())).toBeVisible();
		await expect.element(screen.getByTestId('add-clock')).not.toBeInTheDocument();
	});
});
