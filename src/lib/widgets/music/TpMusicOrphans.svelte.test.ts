import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { fmtBytes } from '$lib/i18n/fmt';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { collection } from './collection.svelte';
import { player } from './player.svelte';
import TpMusicOrphans from './TpMusicOrphans.svelte';

/**
 * Plan S25 in the detail: imported audio a replacing restore left without
 * tracks is shown with what it weighs, and deleted only after the reader has
 * said so twice.
 */

let target: TpDb;

beforeEach(async () => {
	settings.dispose();
	settings.hydrate();
	target = createDb(`tp-music-orphans-${crypto.randomUUID()}`);
	collection.reset(target);
	player.reset({ target });
	await target.tracks.put({
		id: 'kept',
		source: 'blob',
		title: 'Kept',
		artist: '',
		album: '',
		addedAt: 1
	});
	await target.trackBlobs.bulkPut([
		{ id: 'kept', blob: new Blob(['k']) },
		{ id: 'left-1', blob: new Blob([new Uint8Array(3 * 1024 * 1024)]) },
		{ id: 'left-2', blob: new Blob([new Uint8Array(1024 * 1024)]) }
	]);
	await collection.load();
});

afterEach(async () => {
	cleanup();
	collection.reset();
	player.reset();
	settings.dispose();
	target.close();
	await target.delete();
});

describe('TpMusicOrphans', () => {
	it('says how many, and how much, and deletes them only once asked twice', async () => {
		const size = fmtBytes(4 * 1024 * 1024, settings.locale);
		const screen = render(TpMusicOrphans);

		await expect
			.element(screen.getByText(m['widget.music.orphans']({ count: 2, size })))
			.toBeVisible();

		await screen.getByRole('button', { name: m['widget.music.orphans_delete']() }).click();
		await expect
			.element(screen.getByText(m['widget.music.orphans_confirm']({ count: 2, size })))
			.toBeVisible();
		await screen.getByRole('button', { name: m['widget.music.keep']() }).click();
		expect(await target.trackBlobs.count()).toBe(3);

		await screen.getByRole('button', { name: m['widget.music.orphans_delete']() }).click();
		await screen.getByRole('button', { name: m['widget.music.delete'](), exact: true }).click();

		await vi.waitFor(async () => expect(await target.trackBlobs.count()).toBe(1));
		expect(await target.trackBlobs.get('kept')).toBeDefined();
		await expect.element(screen.getByTestId('music-orphans')).not.toBeInTheDocument();
	});

	it('shows nothing when there is nothing to show', async () => {
		await collection.deleteOrphans();
		const screen = render(TpMusicOrphans);

		await expect.element(screen.getByTestId('music-orphans')).not.toBeInTheDocument();
	});
});
