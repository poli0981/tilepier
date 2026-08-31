import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { m } from '$lib/paraglide/messages';
import { setTileStatus, tileStatusChannel } from '$lib/core/tile-status';
import type { TpTile } from './layout';
import TpWidgetHost from './TpWidgetHost.svelte';
import TpStubWidget from './__fixtures__/TpStubWidget.svelte';

/**
 * The host's half of doc 13 §7's badge.
 *
 * **This is the test the whole `core/tile-status` design rests on.** The
 * channel is a plain `.ts` module owning a `SvelteMap` and no rune of its own,
 * on the understanding that `SvelteMap`'s reactivity is compiled inside the
 * `svelte` package rather than by the rune transform. Nothing else in this repo
 * does that — every other reactive module carries the `.svelte.` infix because
 * it holds `$state` — so the assumption gets checked here rather than
 * discovered from a badge that never appears.
 */

function tile(over: Partial<TpTile> = {}): TpTile {
	return { instanceId: 'wgt_a', widgetId: 'clock', x: 0, y: 0, w: 3, h: 2, settings: {}, ...over };
}

beforeEach(() => tileStatusChannel.clear());

afterEach(() => {
	cleanup();
	tileStatusChannel.clear();
});

describe('the stale badge (doc 13 §7)', () => {
	it('shows nothing at all for a tile with nothing to report', async () => {
		const screen = render(TpWidgetHost, { tile: tile(), widget: TpStubWidget });

		await expect.element(screen.getByTestId('stub-body')).toBeInTheDocument();
		await expect.element(screen.getByTestId('tile-badge')).not.toBeInTheDocument();
	});

	it('appears when a widget publishes, with no prop having crossed', async () => {
		// The assumption under test: a module-level `SvelteMap` read through
		// `$derived` inside a component is reactive, from a file with no rune.
		const screen = render(TpWidgetHost, { tile: tile(), widget: TpStubWidget });
		await expect.element(screen.getByTestId('stub-body')).toBeInTheDocument();

		setTileStatus('wgt_a', { kind: 'stale', age: '12 phút trước', retry: null });

		await expect
			.element(screen.getByTestId('tile-badge'))
			.toHaveTextContent(m['common.tile.stale']({ age: '12 phút trước' }));
	});

	it('clears again when the widget takes it back', async () => {
		const screen = render(TpWidgetHost, { tile: tile(), widget: TpStubWidget });
		setTileStatus('wgt_a', { kind: 'stale', age: '12 phút trước', retry: null });
		await expect.element(screen.getByTestId('tile-badge')).toBeInTheDocument();

		setTileStatus('wgt_a', null);

		await expect.element(screen.getByTestId('tile-badge')).not.toBeInTheDocument();
	});

	it('listens only to its own tile', async () => {
		const screen = render(TpWidgetHost, { tile: tile(), widget: TpStubWidget });

		setTileStatus('wgt_b', { kind: 'stale', age: 'a while ago', retry: null });

		await expect.element(screen.getByTestId('stub-body')).toBeInTheDocument();
		await expect.element(screen.getByTestId('tile-badge')).not.toBeInTheDocument();
	});

	it('says offline in its own words, not the top bar’s', async () => {
		// doc 13 §7 has two amber signals: the bar chip is the app's connection,
		// this badge is one tile's data. They read as one thing while they shared
		// a string — and six e2e tests located the chip by that string.
		const screen = render(TpWidgetHost, { tile: tile(), widget: TpStubWidget });

		setTileStatus('wgt_a', { kind: 'offline', age: '', retry: null });

		await expect
			.element(screen.getByTestId('tile-badge'))
			.toHaveTextContent(m['common.tile.offline_short']());
		expect(m['common.tile.offline_short']()).not.toBe(m['common.offline.title']());
	});

	it('offers a retry only when there is something to retry', async () => {
		const screen = render(TpWidgetHost, { tile: tile(), widget: TpStubWidget });

		setTileStatus('wgt_a', { kind: 'stale', age: 'a while ago', retry: null });
		await expect.element(screen.getByTestId('tile-badge')).toBeInTheDocument();
		await expect.element(screen.getByTestId('tile-retry')).not.toBeInTheDocument();

		const retry = vi.fn();
		setTileStatus('wgt_a', { kind: 'stale-error', age: 'a while ago', retry });
		await expect.element(screen.getByTestId('tile-retry')).toBeInTheDocument();

		await screen.getByTestId('tile-retry').click();
		await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
	});
});

describe('the h=1 strip (doc 13 §3)', () => {
	it('reserves more room for the body once a badge joins the cluster', async () => {
		// The measured bug this rule exists for: at h=1 the header floats over the
		// body, so anything in it eats the body's last characters. A badge widens
		// that cluster, and the reserve has to widen with it.
		const screen = render(TpWidgetHost, { tile: tile({ w: 2, h: 1 }), widget: TpStubWidget });
		const host = screen.container.querySelector('.tp-host') as HTMLElement;
		const body = screen.container.querySelector('.tp-host__body') as HTMLElement;

		expect(host.dataset['flat']).toBe('true');
		const bare = parseFloat(getComputedStyle(body).paddingRight);

		setTileStatus('wgt_a', { kind: 'stale', age: 'a while ago', retry: null });
		await expect.element(screen.getByTestId('tile-badge')).toBeInTheDocument();

		expect(host.dataset['badged']).toBe('true');
		expect(parseFloat(getComputedStyle(body).paddingRight)).toBeGreaterThan(bare);
	});

	it('drops the words and keeps the lamp when the header has no room', async () => {
		const screen = render(TpWidgetHost, { tile: tile({ w: 2, h: 1 }), widget: TpStubWidget });
		setTileStatus('wgt_a', { kind: 'stale', age: 'a while ago', retry: null });
		await expect.element(screen.getByTestId('tile-badge')).toBeInTheDocument();

		const text = screen.container.querySelector('.tp-host__badge-text') as HTMLElement;
		const dot = screen.container.querySelector('.tp-host__dot') as HTMLElement;
		const badge = screen.container.querySelector('.tp-host__badge') as HTMLElement;

		expect(getComputedStyle(text).display).toBe('none');
		expect(getComputedStyle(dot).display).not.toBe('none');
		// The sentence has to survive somewhere, so it becomes the accessible name.
		expect(badge.getAttribute('aria-label')).toBeTruthy();
	});
});
