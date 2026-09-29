import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'vitest-browser-svelte';
import { resetPlayback } from '$lib/core/playback';
import { createDb, type TpDb } from '$lib/core/storage/db';
import { m } from '$lib/paraglide/messages';
import { settings } from '$lib/stores/settings.svelte';
import { collection } from './collection.svelte';
import { player } from './player.svelte';
import TpMusicQueue from './TpMusicQueue.svelte';

/**
 * The detail's "coming up" (doc 09 §2): the queue after the current song, in
 * play order, and a jump that keeps the queue.
 */

class QuietAudio extends EventTarget {
	preload = '';
	volume = 1;
	currentTime = 0;
	duration = Number.NaN;
	paused = true;
	error = null;
	src = '';
	async play(): Promise<void> {
		this.paused = false;
		this.dispatchEvent(new Event('playing'));
	}
	pause(): void {
		if (this.paused) return;
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
	}
}

let target: TpDb;

beforeEach(async () => {
	settings.dispose();
	settings.hydrate();
	target = createDb(`tp-music-queue-${crypto.randomUUID()}`);
	collection.reset(target);
	player.reset({
		target,
		createAudio: () => new QuietAudio() as unknown as HTMLAudioElement,
		session: () => null
	});
	for (const [index, title] of ['Anh', 'Bình', 'Cúc', 'Dung'].entries()) {
		const id = `t${String(index)}`;
		await target.tracks.put({ id, source: 'blob', title, artist: '', album: '', addedAt: index });
		await target.trackBlobs.put({ id, blob: new Blob([id]) });
	}
	await collection.load();
});

afterEach(async () => {
	cleanup();
	collection.reset();
	player.reset();
	resetPlayback();
	settings.dispose();
	target.close();
	await target.delete();
});

function titles(container: HTMLElement): string[] {
	return [...container.querySelectorAll('.tp-mqueue__title')].map(
		(node) => node.textContent?.trim() ?? ''
	);
}

describe('TpMusicQueue', () => {
	it('lists what comes after the current song, and jumps without losing the queue', async () => {
		player.playTracks(['t0', 't1', 't2', 't3'], 't0', { kind: 'library' });
		await vi.waitFor(() => expect(player.status).toBe('playing'));
		const screen = render(TpMusicQueue);

		await vi.waitFor(() => expect(titles(screen.container)).toEqual(['Bình', 'Cúc', 'Dung']));

		await screen.getByRole('button', { name: 'Cúc' }).click();

		await vi.waitFor(() => expect(player.current?.title).toBe('Cúc'));
		expect(player.queue.trackIds).toEqual(['t0', 't1', 't2', 't3']);
		await vi.waitFor(() => expect(titles(screen.container)).toEqual(['Dung']));
	});

	it('greys a song gone from the library, and shows nothing at the end of the queue', async () => {
		player.playTracks(['t2', 'gone', 't3'], 't2', { kind: 'library' });
		await vi.waitFor(() => expect(player.status).toBe('playing'));
		const screen = render(TpMusicQueue);

		await expect
			.element(screen.getByRole('button', { name: m['widget.music.gone_from_library']() }))
			.toBeDisabled();

		player.playAt(2);
		await vi.waitFor(() => expect(player.current?.title).toBe('Dung'));
		await expect.element(screen.getByTestId('music-queue')).not.toBeInTheDocument();
	});
});
