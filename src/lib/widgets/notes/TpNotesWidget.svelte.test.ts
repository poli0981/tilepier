import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { db } from '$lib/core/storage/db';
import type { TpTileSize } from '$lib/core/types';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import TpNotesWidget from './TpNotesWidget.svelte';
import { createNote } from './service';

/**
 * doc 07 §4's tile and its states (doc 06 §3, pure-client class).
 *
 * The tile had no component test until Week 8 — journey #5 drove it end to
 * end — and writing one found that a failed read of IndexedDB was caught and
 * shown as `empty`: "no notes yet", with an offer to write the first, to a
 * reader whose notes the tile simply could not read.
 */

const SIZE: TpTileSize = { w: 3, h: 3, pxW: 320, pxH: 320, tier: 'M' };

function props() {
	return { instanceId: 'wgt_notes', settings: {}, size: SIZE };
}

beforeEach(async () => {
	settings.dispose();
	settings.hydrate();
	settings.patch({ locale: 'vi' });
	await db.notes.clear();
});

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	await db.notes.clear();
	settings.dispose();
});

describe('the notes tile (doc 07 §4)', () => {
	it('loading: a gauge while the first read is in flight, never a blank', async () => {
		vi.spyOn(db.notes, 'orderBy').mockReturnValue({
			reverse: () => ({ toArray: () => new Promise(() => undefined) })
		} as never);
		const screen = render(TpNotesWidget, props());

		await expect.element(screen.getByTestId('notes-loading')).toBeInTheDocument();
	});

	it('empty: says there are none, and offers exactly one way to start', async () => {
		const screen = render(TpNotesWidget, props());

		await expect.element(screen.getByText(m['widget.notes.empty']())).toBeInTheDocument();
		await expect
			.element(screen.getByRole('button', { name: m['widget.notes.empty_action']() }))
			.toBeInTheDocument();
	});

	it('ready: the latest note, rendered as markdown', async () => {
		await createNote('# Shopping\nmilk', db);
		const screen = render(TpNotesWidget, props());

		await expect.element(screen.getByRole('heading', { name: 'Shopping' })).toBeInTheDocument();
	});

	it('a read that fails says so, rather than claiming there are no notes', async () => {
		vi.spyOn(db.notes, 'orderBy').mockImplementation(() => {
			throw new Error('idb unavailable');
		});
		const screen = render(TpNotesWidget, props());

		await expect.element(screen.getByText(m['widget.notes.read_failed']())).toBeInTheDocument();
		await expect.element(screen.getByTestId('notes-empty')).not.toBeInTheDocument();

		// And it can be asked again, once whatever stood in the way has gone.
		vi.restoreAllMocks();
		await createNote('# Back\nagain', db);
		await screen.getByRole('button', { name: m['common.retry']() }).click();

		await expect.element(screen.getByRole('heading', { name: 'Back' })).toBeInTheDocument();
	});
});
