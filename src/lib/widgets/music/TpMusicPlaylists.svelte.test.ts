import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { collection } from './collection.svelte';
import { player } from './player.svelte';
import { playlists } from './playlists.svelte';
import TpMusicLibrary from './TpMusicLibrary.svelte';
import TpMusicPlaylists from './TpMusicPlaylists.svelte';

/**
 * doc 09 §2's playlists, with the library list beside them the way the detail
 * shows them: create one, fill it with the library's "+", reorder it with the
 * buttons, play it, delete it — and every change is in Dexie at once.
 */

let target: TpDb;

beforeEach(async () => {
	settings.dispose();
	settings.hydrate();
	target = createDb(`tp-music-playlists-${crypto.randomUUID()}`);
	collection.reset(target);
	playlists.reset(target);
	player.reset({ target });
	await target.tracks.bulkPut([
		{ id: 'a', source: 'blob', title: 'Anh', artist: 'X', album: '', addedAt: 1 },
		{ id: 'b', source: 'blob', title: 'Bình', artist: 'X', album: '', addedAt: 2 },
		{ id: 'c', source: 'blob', title: 'Cúc', artist: 'X', album: '', addedAt: 3 }
	]);
	await collection.load();
});

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	collection.reset();
	playlists.reset();
	player.reset();
	settings.dispose();
	target.close();
	await target.delete();
});

async function stored(): Promise<string[] | undefined> {
	return (await target.playlists.toArray())[0]?.trackIds;
}

describe('TpMusicPlaylists', () => {
	it('creates a playlist, chosen at once, and the library’s + fills it', async () => {
		const screen = render(TpMusicPlaylists);
		const list = render(TpMusicLibrary);

		await screen.getByTestId('music-playlist-name').fill('Chạy bộ');
		await screen.getByRole('button', { name: m['widget.music.playlist_create']() }).click();
		await expect.element(screen.getByTestId('music-playlist')).toBeVisible();

		await list
			.getByRole('button', {
				name: m['widget.music.add_to_playlist']({ title: 'Bình', playlist: 'Chạy bộ' })
			})
			.click();
		await list
			.getByRole('button', {
				name: m['widget.music.add_to_playlist']({ title: 'Anh', playlist: 'Chạy bộ' })
			})
			.click();

		await vi.waitFor(async () => expect(await stored()).toEqual(['b', 'a']));
		// A second press on the same + changes nothing.
		await expect
			.element(
				list.getByRole('button', {
					name: m['widget.music.add_to_playlist']({ title: 'Anh', playlist: 'Chạy bộ' })
				})
			)
			.toBeDisabled();
	});

	it('reorders with the buttons, and takes a song off', async () => {
		await playlists.create('P');
		await playlists.add(playlists.activeId ?? '', 'a');
		await playlists.add(playlists.activeId ?? '', 'b');
		await playlists.add(playlists.activeId ?? '', 'c');
		const screen = render(TpMusicPlaylists);

		await screen.getByRole('button', { name: m['widget.music.move_up']({ title: 'Cúc' }) }).click();
		await vi.waitFor(async () => expect(await stored()).toEqual(['a', 'c', 'b']));

		await screen
			.getByRole('button', { name: m['widget.music.remove_from_playlist']({ title: 'Anh' }) })
			.click();
		await vi.waitFor(async () => expect(await stored()).toEqual(['c', 'b']));
		await expect
			.element(screen.getByRole('button', { name: m['widget.music.move_up']({ title: 'Cúc' }) }))
			.toBeDisabled();
	});

	it('plays the songs still in the library, as a playlist queue', async () => {
		await playlists.create('P');
		const id = playlists.activeId ?? '';
		for (const track of ['c', 'gone', 'a']) await playlists.add(id, track);
		const playTracks = vi.spyOn(player, 'playTracks').mockImplementation(() => {});
		const screen = render(TpMusicPlaylists);

		await expect.element(screen.getByText(m['widget.music.gone_from_library']())).toBeVisible();
		await screen.getByRole('button', { name: m['widget.music.playlist_play']() }).click();

		expect(playTracks).toHaveBeenCalledWith(['c', 'a'], 'c', { kind: 'playlist', id });
	});

	it('asks before deleting, and deletes the list, never the songs', async () => {
		await playlists.create('Buồn');
		await playlists.add(playlists.activeId ?? '', 'a');
		const screen = render(TpMusicPlaylists);

		await screen.getByRole('button', { name: m['widget.music.playlist_delete']() }).click();
		await expect
			.element(screen.getByText(m['widget.music.playlist_delete_confirm']({ name: 'Buồn' })))
			.toBeVisible();
		await screen.getByRole('button', { name: m['widget.music.keep']() }).click();
		expect(await target.playlists.count()).toBe(1);

		await screen.getByRole('button', { name: m['widget.music.playlist_delete']() }).click();
		await screen.getByRole('button', { name: m['widget.music.delete'](), exact: true }).click();

		await vi.waitFor(async () => expect(await target.playlists.count()).toBe(0));
		expect(await target.tracks.count()).toBe(3);
	});

	it('keeps every action when two land before the first write is done', async () => {
		// Two "+" presses, or a create and an add, a few milliseconds apart: each
		// must build on the one before, not on the list as the last write left it.
		await playlists.create('P');
		const id = playlists.activeId ?? '';

		await Promise.all([playlists.add(id, 'a'), playlists.add(id, 'b'), playlists.add(id, 'c')]);
		expect(await stored()).toEqual(['a', 'b', 'c']);

		await Promise.all([playlists.create('Q'), playlists.create('R')]);
		const orders = (await target.playlists.orderBy('order').toArray()).map((row) => row.name);
		expect(orders).toEqual(['P', 'Q', 'R']);
	});

	it('keeps a rename on Enter, and ignores a blank one', async () => {
		await playlists.create('Cũ');
		const screen = render(TpMusicPlaylists);
		const name = screen.getByRole('textbox', { name: m['widget.music.playlist_name']() });

		await name.fill('Mới');
		await name.click();
		(name.element() as HTMLInputElement).dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
		);
		await vi.waitFor(async () => expect((await target.playlists.toArray())[0]?.name).toBe('Mới'));

		await name.fill('   ');
		(name.element() as HTMLInputElement).dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
		);
		await expect.element(name).toHaveValue('Mới');
		await playlists.rename(playlists.activeId ?? '', '   ');
		expect((await target.playlists.toArray())[0]?.name).toBe('Mới');
	});
});
