import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { createDb, type TpDb, type TpTrack } from '$lib/core/storage/db';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { collection } from './collection.svelte';
import { player } from './player.svelte';
import TpMusicLibrary from './TpMusicLibrary.svelte';

/**
 * The detail's library list (doc 09 §2, Week 7 plan S13): search that folds
 * diacritics, sorting, windowing, and a row starting playback with the list as
 * it stands.
 */

let target: TpDb;

beforeEach(() => {
	settings.dispose();
	settings.hydrate();
	target = createDb(`tp-music-list-${crypto.randomUUID()}`);
	collection.reset(target);
	player.reset({ target });
});

afterEach(async () => {
	cleanup();
	vi.restoreAllMocks();
	collection.reset();
	player.reset();
	settings.dispose();
	target.close();
	await target.delete();
});

function track(id: string, fields: Partial<TpTrack> = {}): TpTrack {
	return { id, source: 'blob', title: id, artist: '', album: '', addedAt: 0, ...fields };
}

async function load(tracks: TpTrack[]): Promise<void> {
	await target.tracks.bulkPut(tracks);
	// Imported tracks with their audio: one without reads as missing (plan S25).
	await target.trackBlobs.bulkPut(
		tracks.map((entry) => ({ id: entry.id, blob: new Blob([entry.id]) }))
	);
	await collection.load();
}

function titles(container: HTMLElement): string[] {
	return [...container.querySelectorAll('.tp-mrow__title')].map((node) => node.textContent ?? '');
}

describe('TpMusicLibrary', () => {
	it('finds "Sơn Tùng" when the reader types "son tung"', async () => {
		await load([
			track('a', { title: 'Chúng ta của hiện tại', artist: 'Sơn Tùng M-TP' }),
			track('b', { title: 'Một bài khác', artist: 'Người khác' })
		]);
		const screen = render(TpMusicLibrary);

		await screen.getByTestId('music-search').fill('son tung');

		await vi.waitFor(() => expect(titles(screen.container)).toEqual(['Chúng ta của hiện tại']));
	});

	it('says so when nothing matches', async () => {
		await load([track('a', { title: 'Một' })]);
		const screen = render(TpMusicLibrary);

		await screen.getByTestId('music-search').fill('zzz');

		await expect
			.element(screen.getByText(m['widget.music.no_match']({ query: 'zzz' })))
			.toBeVisible();
	});

	it('sorts by title and by what was added last', async () => {
		await load([
			track('x', { title: 'Bravo', artist: 'A', addedAt: 1 }),
			track('y', { title: 'Alpha', artist: 'B', addedAt: 3 }),
			track('z', { title: 'Charlie', artist: 'C', addedAt: 2 })
		]);
		const screen = render(TpMusicLibrary);
		await vi.waitFor(() => expect(titles(screen.container)).toEqual(['Bravo', 'Alpha', 'Charlie']));

		await screen.getByTestId('music-sort').selectOptions('title');
		await vi.waitFor(() => expect(titles(screen.container)).toEqual(['Alpha', 'Bravo', 'Charlie']));

		await screen.getByTestId('music-sort').selectOptions('added');
		await vi.waitFor(() => expect(titles(screen.container)).toEqual(['Alpha', 'Charlie', 'Bravo']));
	});

	it('renders a window of a long library, not all of it', async () => {
		await load(
			Array.from({ length: 2000 }, (_, index) =>
				track(`t${String(index).padStart(4, '0')}`, { artist: 'A', trackNo: index + 1 })
			)
		);
		const screen = render(TpMusicLibrary);

		await vi.waitFor(() => expect(titles(screen.container).length).toBeGreaterThan(0));
		const rendered = screen.container.querySelectorAll('li');
		expect(rendered.length).toBeLessThan(80);
		// Screen readers are still told how long the list is.
		expect(rendered[0]?.getAttribute('aria-setsize')).toBe('2000');

		const list = screen.getByTestId('music-list').element() as HTMLElement;
		list.scrollTop = 44 * 1000;
		list.dispatchEvent(new Event('scroll'));
		await vi.waitFor(() => expect(titles(screen.container)).toContain('t1000'));
	});

	it('plays a chosen row with the filtered list as its queue', async () => {
		await load([
			track('a', { title: 'Một', artist: 'X' }),
			track('b', { title: 'Hai', artist: 'Y' }),
			track('c', { title: 'Ba', artist: 'X' })
		]);
		const playTracks = vi.spyOn(player, 'playTracks').mockImplementation(() => {});
		const screen = render(TpMusicLibrary);
		await screen.getByTestId('music-search').fill('x');

		await screen.getByRole('button', { name: /Ba/ }).click();

		expect(playTracks).toHaveBeenCalledWith(['c', 'a'], 'c', { kind: 'library' });
	});

	it('empties the search on Escape before letting the key close anything', async () => {
		await load([track('a', { title: 'Một' })]);
		const outer = vi.fn();
		document.addEventListener('keydown', outer);
		try {
			const screen = render(TpMusicLibrary);
			const search = screen.getByTestId('music-search');
			await search.fill('abc');

			(search.element() as HTMLElement).dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
			);

			await expect.element(search).toHaveValue('');
			expect(outer).not.toHaveBeenCalled();
		} finally {
			document.removeEventListener('keydown', outer);
		}
	});

	it('marks what cannot play, and removes the missing on request', async () => {
		await load([
			track('a', { title: 'Gone', missing: true }),
			track('b', { title: 'Odd', error: 'unsupported' }),
			track('c', { title: 'Fine' })
		]);
		const screen = render(TpMusicLibrary);

		await expect
			.element(screen.getByText(m['widget.music.mark_missing'](), { exact: true }))
			.toBeVisible();
		await expect.element(screen.getByText(m['widget.music.mark_unsupported']())).toBeVisible();

		await screen.getByTestId('music-remove-missing').click();

		await vi.waitFor(async () => expect(await target.tracks.get('a')).toBeUndefined());
		await vi.waitFor(() => expect(titles(screen.container)).not.toContain('Gone'));
		expect(await target.tracks.count()).toBe(2);
	});
});
