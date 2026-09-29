import { flushSync } from 'svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claimPlayback, resetPlayback } from '$lib/core/playback';
import { createDb, type TpDb, type TpTrack } from '$lib/core/storage/db';
import { m } from '$lib/paraglide/messages';
import { deck } from '$lib/stores/deck.svelte';
import { toasts } from '$lib/stores/toast.svelte';
import { saveMusicRoot } from './library';
import { player, SAVE_EVERY_MS, type TpPlayerNotice } from './player.svelte';

/**
 * doc 09 §2's player, and Week 7 plan S2/S3/S10/S12 — against a stand-in
 * `<audio>` the test drives, and a real Dexie. The element is the one thing a
 * test cannot usefully run for real at speed; everything around it is real.
 */

type TpPlayOutcome = 'ok' | 'NotAllowedError' | 'AbortError' | 'unsupported';

/** An `<audio>` that does what it is told, when it is told. */
class FakeAudio extends EventTarget {
	preload = '';
	volume = 1;
	currentTime = 0;
	duration = Number.NaN;
	paused = true;
	error: { code: number } | null = null;
	playResult: TpPlayOutcome = 'ok';
	/** Outcomes for the next `play()` calls, in order, before `playResult`. */
	script: TpPlayOutcome[] = [];
	plays = 0;
	#src = '';

	get src(): string {
		return this.#src;
	}

	set src(value: string) {
		// A new source resets the element, as the real one's load algorithm does.
		this.#src = value;
		this.error = null;
		this.currentTime = 0;
		this.duration = Number.NaN;
	}

	async play(): Promise<void> {
		this.plays += 1;
		const outcome = this.script.shift() ?? this.playResult;
		if (outcome === 'unsupported') {
			// What a real element does with a source it cannot decode: it never
			// reaches `playing` — it errors, and the play() promise rejects.
			this.fail(4);
			throw new DOMException('no supported source', 'NotSupportedError');
		}
		if (outcome !== 'ok') throw new DOMException('refused', outcome);
		this.paused = false;
		this.dispatchEvent(new Event('playing'));
	}

	pause(): void {
		if (this.paused) return;
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
	}

	metadata(seconds: number): void {
		this.duration = seconds;
		this.dispatchEvent(new Event('loadedmetadata'));
	}

	tick(seconds: number): void {
		this.currentTime = seconds;
		this.dispatchEvent(new Event('timeupdate'));
	}

	end(): void {
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
		this.dispatchEvent(new Event('ended'));
	}

	fail(code: number): void {
		this.error = { code };
		this.dispatchEvent(new Event('error'));
	}
}

/** The page's Media Session, as the OS's keys see it: what it was told, and
 *  a press on any key it was given. */
class FakeSession {
	metadata: MediaMetadata | null = null;
	playbackState: MediaSessionPlaybackState = 'none';
	handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>();
	positions: (MediaPositionState | undefined)[] = [];
	/** Actions this "browser" does not know: setting one throws. */
	unknown = new Set<MediaSessionAction>();

	setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null): void {
		if (this.unknown.has(action)) throw new TypeError(`unknown action: ${action}`);
		this.handlers.set(action, handler);
	}

	setPositionState(state?: MediaPositionState): void {
		this.positions.push(state);
	}

	press(action: MediaSessionAction, details: Partial<MediaSessionActionDetails> = {}): void {
		const handler = this.handlers.get(action);
		if (typeof handler !== 'function') throw new Error(`no handler for ${action}`);
		handler({ action, ...details });
	}
}

/** What a real session would have refused: an unknown length, or a place
 *  outside the track. */
function placeable(state: MediaPositionState | undefined): boolean {
	if (state === undefined) return true;
	const { duration = Number.NaN, position = 0 } = state;
	return Number.isFinite(duration) && position >= 0 && position <= duration;
}

let target: TpDb;
let audio: FakeAudio;
let session: FakeSession;
let notices: TpPlayerNotice[];
let clock: number;

function reset(): void {
	player.reset({
		target,
		createAudio: () => audio as unknown as HTMLAudioElement,
		now: () => clock,
		random: () => 0,
		notify: (notice) => notices.push(notice),
		session: () => session
	});
}

beforeEach(() => {
	target = createDb(`tp-player-test-${crypto.randomUUID()}`);
	audio = new FakeAudio();
	session = new FakeSession();
	notices = [];
	clock = 1_000_000;
	deck.dispose();
	reset();
});

afterEach(async () => {
	player.reset();
	resetPlayback();
	deck.dispose();
	target.close();
	await target.delete();
});

/** Imported tracks with their bytes, unless `withoutBytes` names one. */
async function seed(ids: string[], withoutBytes: string[] = []): Promise<void> {
	for (const id of ids) {
		const track: TpTrack = {
			id,
			source: 'blob',
			title: `Song ${id}`,
			artist: '',
			album: '',
			addedAt: 1
		};
		await target.tracks.put(track);
		if (!withoutBytes.includes(id)) {
			await target.trackBlobs.put({ id, blob: new Blob([id], { type: 'audio/wav' }) });
		}
	}
}

async function playing(id: string): Promise<void> {
	await vi.waitFor(() => {
		expect(player.current?.id).toBe(id);
		expect(player.status).toBe('playing');
	});
}

describe('the queue (doc 09 §2)', () => {
	it('plays the chosen track, then the next when it ends', async () => {
		await seed(['a', 'b', 'c']);

		player.playTracks(['a', 'b', 'c'], 'b', { kind: 'library' });
		await playing('b');

		audio.end();
		await playing('c');
	});

	it('stops at the end of the queue, back at the start of the last track', async () => {
		await seed(['a', 'b']);
		player.playTracks(['a', 'b'], 'b', { kind: 'library' });
		await playing('b');

		audio.tick(0.9);
		audio.end();

		await vi.waitFor(() => expect(player.status).toBe('paused'));
		expect(player.current?.id).toBe('b');
		expect(player.positionMs).toBe(0);
	});

	it('wraps on repeat-all; repeat-one replays an ending track but next still moves on', async () => {
		await seed(['a', 'b']);
		player.cycleRepeat();
		expect(player.repeat).toBe('all');
		player.playTracks(['a', 'b'], 'b', { kind: 'library' });
		await playing('b');

		audio.end();
		await playing('a');

		player.cycleRepeat();
		expect(player.repeat).toBe('one');
		const plays = audio.plays;
		audio.end();
		await vi.waitFor(() => expect(audio.plays).toBe(plays + 1));
		expect(player.current?.id).toBe('a');

		player.next();
		await playing('b');
	});

	it('jumps to a song further down the queue, and keeps the queue as it was', async () => {
		await seed(['a', 'b', 'c', 'd']);
		player.playTracks(['a', 'b', 'c', 'd'], 'a', { kind: 'library' });
		await playing('a');

		player.playAt(2);
		await playing('c');
		expect(player.queue.trackIds).toEqual(['a', 'b', 'c', 'd']);
		audio.end();
		await playing('d');

		player.playAt(9);
		player.playAt(-1);
		expect(player.current?.id).toBe('d');
	});

	it('restarts the track past three seconds, and goes back before that', async () => {
		await seed(['a', 'b']);
		player.playTracks(['a', 'b'], 'b', { kind: 'library' });
		await playing('b');

		audio.tick(5);
		player.prev();
		expect(player.current?.id).toBe('b');
		expect(player.positionMs).toBe(0);

		audio.tick(1);
		player.prev();
		await playing('a');
	});

	it('keeps the current track through shuffle, and deals the rest', async () => {
		await seed(['a', 'b', 'c', 'd']);
		player.playTracks(['a', 'b', 'c', 'd'], 'b', { kind: 'library' });
		await playing('b');

		player.setShuffle(true);
		expect(player.queue.order[player.queue.index]).toBe(1);
		expect([...player.queue.order].sort()).toEqual([0, 1, 2, 3]);

		player.setShuffle(false);
		expect(player.queue.order).toEqual([0, 1, 2, 3]);
		expect(player.queue.index).toBe(1);
	});
});

describe('failures (Week 7 plan S12)', () => {
	it('marks a format this browser cannot decode, and skips it', async () => {
		await seed(['a', 'b']);
		audio.script = ['unsupported'];

		player.playTracks(['a', 'b'], 'a', { kind: 'library' });

		await playing('b');
		expect((await target.tracks.get('a'))?.error).toBe('unsupported');
		expect(notices).toEqual([{ kind: 'skipped', title: 'Song a' }]);
	});

	it('stops after three in a row, and says so once', async () => {
		// A library whose drive was unplugged would otherwise spin through every
		// track — for ever, on repeat-all.
		await seed(['a', 'b', 'c', 'd']);
		player.cycleRepeat();
		audio.playResult = 'unsupported';

		player.playTracks(['a', 'b', 'c', 'd'], 'a', { kind: 'library' });

		await vi.waitFor(() => expect(notices).toContainEqual({ kind: 'stopped' }));
		expect(player.status).toBe('paused');
		expect(player.current?.id).toBe('c');
		expect(notices).toEqual([
			{ kind: 'skipped', title: 'Song a' },
			{ kind: 'skipped', title: 'Song b' },
			{ kind: 'stopped' }
		]);
	});

	it('counts only failures in a row: a track that plays resets the count', async () => {
		await seed(['a', 'b', 'c', 'd', 'e']);
		audio.script = ['unsupported', 'ok', 'unsupported', 'unsupported', 'ok'];

		player.playTracks(['a', 'b', 'c', 'd', 'e'], 'a', { kind: 'library' });
		await playing('b');
		audio.end();

		await playing('e');
		expect(notices).not.toContainEqual({ kind: 'stopped' });
	});

	it('reads a decode error part-way through as a failure too', async () => {
		// Not a format problem (that never reaches `playing`): the bytes broke.
		await seed(['a', 'b']);
		player.playTracks(['a', 'b'], 'a', { kind: 'library' });
		await playing('a');

		audio.fail(3);

		await playing('b');
		expect((await target.tracks.get('a'))?.error).toBe('unreadable');
	});

	it('marks an imported song whose bytes are gone as missing, and skips it', async () => {
		await seed(['a', 'b'], ['a']);

		player.playTracks(['a', 'b'], 'a', { kind: 'library' });

		await playing('b');
		expect((await target.tracks.get('a'))?.missing).toBe(true);
	});

	it('reads a browser refusing to autoplay as "press play": nothing marked, nothing skipped', async () => {
		await seed(['a', 'b']);
		audio.playResult = 'NotAllowedError';

		player.playTracks(['a', 'b'], 'a', { kind: 'library' });

		await vi.waitFor(() => expect(player.status).toBe('blocked'));
		expect(player.current?.id).toBe('a');
		expect(await target.tracks.get('a')).not.toHaveProperty('error');
		expect(notices).toEqual([]);

		audio.playResult = 'ok';
		player.play();
		await playing('a');
	});

	it('does not count a newer source cutting in as a failure', async () => {
		// Next, pressed twice quickly: the first play() is aborted by the second
		// source. Three of those must not stop the player.
		await seed(['a', 'b', 'c', 'd']);
		audio.playResult = 'AbortError';

		player.playTracks(['a', 'b', 'c', 'd'], 'a', { kind: 'library' });
		player.next();
		player.next();
		player.next();

		await vi.waitFor(() => expect(player.current?.id).toBe('d'));
		expect(notices).toEqual([]);
	});

	it('asks for the folder again when its grant has lapsed, and marks nothing', async () => {
		const opfs = await navigator.storage.getDirectory();
		const name = `tp-player-${crypto.randomUUID()}`;
		const folder = await opfs.getDirectoryHandle(name, { create: true });
		const writable = await (
			await folder.getFileHandle('one.wav', { create: true })
		).createWritable();
		await writable.write('x');
		await writable.close();
		await saveMusicRoot(folder, target);
		await target.tracks.put({
			id: 'f',
			source: 'fsa',
			relPath: 'one.wav',
			title: 'One',
			artist: '',
			album: '',
			addedAt: 1
		});
		const real = FileSystemDirectoryHandle.prototype.getFileHandle;
		const lapsed = vi
			.spyOn(FileSystemDirectoryHandle.prototype, 'getFileHandle')
			.mockRejectedValue(new DOMException('lapsed', 'NotAllowedError'));

		try {
			player.playTracks(['f'], 'f', { kind: 'library' });

			await vi.waitFor(() => expect(player.status).toBe('permission'));
			expect(await target.tracks.get('f')).not.toHaveProperty('missing');
			expect(notices).toEqual([]);

			// Re-link, as the tile's card does, and play resumes.
			lapsed.mockImplementation(real);
			player.play();
			await playing('f');
		} finally {
			lapsed.mockRestore();
			await opfs.removeEntry(name, { recursive: true });
		}
	});
});

describe('a tab in the background (plan S23)', () => {
	it('plays on past a lapsed grant with the files it held while it could', async () => {
		// Chrome revokes an "Allow this time" folder grant once a tab has sat in
		// the background a while; a File taken before that still reads (doc 22
		// §S7, the owner's check). So the player holds the next tracks' Files.
		const opfs = await navigator.storage.getDirectory();
		const name = `tp-player-${crypto.randomUUID()}`;
		const folder = await opfs.getDirectoryHandle(name, { create: true });
		for (const file of ['one.wav', 'two.wav', 'three.wav']) {
			const writable = await (await folder.getFileHandle(file, { create: true })).createWritable();
			await writable.write(file);
			await writable.close();
		}
		await saveMusicRoot(folder, target);
		await target.tracks.bulkPut(
			['one', 'two', 'three'].map((id, index) => ({
				id,
				source: 'fsa' as const,
				relPath: `${id}.wav`,
				title: id,
				artist: '',
				album: '',
				addedAt: index
			}))
		);
		const reads = vi.spyOn(FileSystemFileHandle.prototype, 'getFile');

		try {
			player.playTracks(['one', 'two', 'three'], 'one', { kind: 'library' });
			await playing('one');
			// The playing track, and the two after it.
			await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(3));

			const lapsed = vi
				.spyOn(FileSystemDirectoryHandle.prototype, 'getFileHandle')
				.mockRejectedValue(new DOMException('lapsed', 'NotAllowedError'));
			audio.end();
			await playing('two');
			audio.end();
			await playing('three');

			expect(notices).toEqual([]);
			lapsed.mockRestore();
		} finally {
			await opfs.removeEntry(name, { recursive: true });
		}
	});

	it('still asks for the grant when it holds nothing for the track', async () => {
		const opfs = await navigator.storage.getDirectory();
		const name = `tp-player-${crypto.randomUUID()}`;
		const folder = await opfs.getDirectoryHandle(name, { create: true });
		const writable = await (
			await folder.getFileHandle('one.wav', { create: true })
		).createWritable();
		await writable.write('x');
		await writable.close();
		await saveMusicRoot(folder, target);
		await target.tracks.put({
			id: 'one',
			source: 'fsa',
			relPath: 'one.wav',
			title: 'One',
			artist: '',
			album: '',
			addedAt: 1
		});
		const lapsed = vi
			.spyOn(FileSystemDirectoryHandle.prototype, 'getFileHandle')
			.mockRejectedValue(new DOMException('lapsed', 'NotAllowedError'));

		try {
			player.playTracks(['one'], 'one', { kind: 'library' });

			await vi.waitFor(() => expect(player.status).toBe('permission'));
		} finally {
			lapsed.mockRestore();
			await opfs.removeEntry(name, { recursive: true });
		}
	});
});

describe('what it learns while playing', () => {
	it('keeps a duration the scan could not know', async () => {
		await seed(['a']);
		player.playTracks(['a'], 'a', { kind: 'library' });
		await playing('a');

		audio.metadata(2.011);

		await vi.waitFor(async () => expect((await target.tracks.get('a'))?.durationMs).toBe(2011));
		expect(player.durationMs).toBe(2011);
	});
});

describe('resume (doc 09 §2, plan S10)', () => {
	it('saves where it was at most every ten seconds, and on pause', async () => {
		await seed(['a']);
		player.playTracks(['a'], 'a', { kind: 'library' });
		await playing('a');

		audio.tick(4);
		const early = await target.playback.get('music');
		expect(early?.state).toMatchObject({ positionMs: 0 });

		clock += SAVE_EVERY_MS;
		audio.tick(12);
		await vi.waitFor(async () =>
			expect((await target.playback.get('music'))?.state).toMatchObject({ positionMs: 12_000 })
		);

		audio.tick(13.5);
		player.pause();
		await vi.waitFor(async () =>
			expect((await target.playback.get('music'))?.state).toMatchObject({ positionMs: 13_500 })
		);
	});

	it('keeps where it was when the page closes, committed before the page can go', async () => {
		await seed(['a']);
		player.playTracks(['a'], 'a', { kind: 'library' });
		await playing('a');
		audio.tick(21);
		const commit = vi.spyOn(IDBTransaction.prototype, 'commit');

		window.dispatchEvent(new PageTransitionEvent('pagehide'));

		// Inside the handler: a put Dexie commits once it has succeeded goes
		// with a closing page (measured in journey-media, doc 04 §6).
		expect(commit).toHaveBeenCalled();
		commit.mockRestore();
		await vi.waitFor(async () =>
			expect((await target.playback.get('music'))?.state).toMatchObject({ positionMs: 21_000 })
		);
	});

	it('comes back after a reload paused where it was — never playing on its own', async () => {
		await seed(['a', 'b', 'c']);
		player.playTracks(['a', 'b', 'c'], 'b', { kind: 'library' });
		await playing('b');
		audio.tick(42);
		player.pause();
		await vi.waitFor(async () =>
			expect((await target.playback.get('music'))?.state).toMatchObject({ positionMs: 42_000 })
		);

		// A reload: a fresh player over the same database.
		audio = new FakeAudio();
		reset();
		await player.restore();

		expect(player.current?.id).toBe('b');
		expect(player.status).toBe('paused');
		expect(player.positionMs).toBe(42_000);
		expect(player.queue.trackIds).toEqual(['a', 'b', 'c']);
		expect(audio.plays).toBe(0);

		player.play();
		await playing('b');
		audio.metadata(180);
		expect(audio.currentTime).toBe(42);
	});
});

describe('the tile leaving the deck (plan S3)', () => {
	async function playOnDeck(): Promise<string> {
		deck.hydrate();
		const tile = deck.add('music');
		if (tile === null) throw new Error('music should be addable');
		flushSync();
		await seed(['a']);
		player.playTracks(['a'], 'a', { kind: 'library' });
		await playing('a');
		return tile.instanceId;
	}

	it('stops when its tile is removed', async () => {
		const id = await playOnDeck();

		deck.remove(id);
		flushSync();

		expect(audio.paused).toBe(true);
		expect(player.status).toBe('paused');
	});

	it('stops when the deck is reset from Settings, where no deck page is mounted', async () => {
		await playOnDeck();

		deck.reset();
		flushSync();

		expect(audio.paused).toBe(true);
	});

	it('keeps playing through a replaced deck that still has it, and stops for one that does not', async () => {
		await playOnDeck();

		deck.replaceAll([...deck.tiles]);
		flushSync();
		expect(audio.paused).toBe(false);

		deck.replaceAll(deck.tiles.filter((tile) => tile.widgetId !== 'music'));
		flushSync();
		expect(audio.paused).toBe(true);
	});

	it('clears the Media Session as it stops, so a media key cannot start it again', async () => {
		const id = await playOnDeck();
		await vi.waitFor(() => expect(session.metadata?.title).toBe('Song a'));

		deck.remove(id);
		flushSync();

		expect(session.metadata).toBeNull();
		expect(session.playbackState).toBe('none');
		expect([...session.handlers.values()].every((handler) => handler === null)).toBe(true);
	});
});

describe('one sound at a time (plan S4)', () => {
	it('pauses when the other player starts', async () => {
		await seed(['a']);
		player.playTracks(['a'], 'a', { kind: 'library' });
		await playing('a');

		claimPlayback('media', () => {});

		expect(audio.paused).toBe(true);
		await vi.waitFor(() => expect(player.status).toBe('paused'));
	});

	it('leaves the Media Session to the player that took the sound', async () => {
		await seed(['a']);
		player.playTracks(['a'], 'a', { kind: 'library' });
		await playing('a');
		await vi.waitFor(() => expect(session.metadata?.title).toBe('Song a'));

		// The yield pauses this player inside the claim. Its pause must not say
		// "paused" over the session the video player is about to fill.
		claimPlayback('media', () => {});
		expect(session.playbackState).toBe('playing');
		const theirs = new MediaMetadata({ title: 'Phim' });
		session.metadata = theirs;

		player.seek(10_000);
		expect(session.metadata).toBe(theirs);
		expect(session.positions.filter((state) => state?.position === 10)).toHaveLength(0);
	});
});

describe('the Media Session (doc 09 §2)', () => {
	async function seedCovered(): Promise<void> {
		await seed(['a', 'b', 'c']);
		const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
		await target.trackBlobs.bulkPut([
			{ id: 'cover:x', blob: png },
			{ id: 'cover:y', blob: png }
		]);
		await target.tracks.update('a', { coverId: 'cover:x', artist: 'Mỹ Tâm', album: 'Tâm' });
		await target.tracks.update('b', { coverId: 'cover:x' });
		await target.tracks.update('c', { coverId: 'cover:y' });
	}

	it('fills the session when a track starts: the words, the cover, the keys', async () => {
		await seedCovered();

		player.playTracks(['a', 'b', 'c'], 'a', { kind: 'library' });
		await playing('a');

		await vi.waitFor(() => expect(session.metadata?.title).toBe('Song a'));
		expect(session.metadata?.artist).toBe('Mỹ Tâm');
		expect(session.metadata?.album).toBe('Tâm');
		expect(session.metadata?.artwork[0]?.src).toMatch(/^blob:/);
		expect(session.metadata?.artwork[0]?.type).toBe('image/png');
		expect(session.playbackState).toBe('playing');
		for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'seekto'] as const) {
			expect(session.handlers.get(action)).toBeTypeOf('function');
		}
		// iOS shows skip-ten-seconds instead of previous and next while these
		// exist; `stop` would end what the tile can only pause.
		for (const action of ['seekbackward', 'seekforward', 'stop'] as const) {
			expect(session.handlers.get(action)).toBeNull();
		}
	});

	it('answers the keys: next, seek, pause, play and previous', async () => {
		await seedCovered();
		player.playTracks(['a', 'b', 'c'], 'a', { kind: 'library' });
		await playing('a');

		session.press('nexttrack');
		await playing('b');
		await vi.waitFor(() => expect(session.metadata?.title).toBe('Song b'));
		expect(session.metadata?.artist).toBe(m['widget.music.unknown_artist']());

		audio.metadata(120);
		session.press('seekto', { seekTime: 30 });
		expect(player.positionMs).toBe(30_000);
		expect(session.positions.at(-1)).toEqual({ duration: 120, position: 30, playbackRate: 1 });

		session.press('pause');
		expect(player.status).toBe('paused');
		expect(session.playbackState).toBe('paused');

		session.press('play');
		await playing('b');
		expect(session.playbackState).toBe('playing');

		// Past three seconds, previous goes back to the start of this track.
		session.press('previoustrack');
		expect(player.current?.id).toBe('b');
		expect(player.positionMs).toBe(0);
	});

	it('shares one cover URL across an album, and lets it go for the next cover', async () => {
		await seedCovered();
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		player.playTracks(['a', 'b', 'c'], 'a', { kind: 'library' });
		await playing('a');
		await vi.waitFor(() => expect(session.metadata?.title).toBe('Song a'));
		const first = session.metadata?.artwork[0]?.src;

		player.next();
		await vi.waitFor(() => expect(session.metadata?.title).toBe('Song b'));
		expect(session.metadata?.artwork[0]?.src).toBe(first);
		expect(revoke).not.toHaveBeenCalledWith(first);

		player.next();
		await vi.waitFor(() => expect(session.metadata?.title).toBe('Song c'));
		expect(session.metadata?.artwork[0]?.src).not.toBe(first);
		expect(revoke).toHaveBeenCalledWith(first);
		revoke.mockRestore();
	});

	it('never hands the lock screen a length it does not know, or a place past the end', async () => {
		await seed(['a']);

		player.playTracks(['a'], 'a', { kind: 'library' });
		await playing('a');
		// Before its metadata the element knows no duration: a clear, not a throw.
		expect(session.positions.at(-1)).toBeUndefined();

		audio.metadata(60);
		player.seek(90_000);

		expect(session.positions.at(-1)).toEqual({ duration: 60, position: 60, playbackRate: 1 });
		expect(session.positions.every(placeable)).toBe(true);
	});

	it('goes on without a key the browser does not know', async () => {
		session.unknown.add('seekto');
		await seed(['a', 'b']);

		player.playTracks(['a', 'b'], 'a', { kind: 'library' });
		await playing('a');

		expect(session.handlers.has('seekto')).toBe(false);
		session.press('nexttrack');
		await playing('b');
	});

	it('plays in a browser with no Media Session at all', async () => {
		player.reset({
			target,
			createAudio: () => audio as unknown as HTMLAudioElement,
			session: () => null
		});
		await seed(['a']);

		player.playTracks(['a'], 'a', { kind: 'library' });

		await playing('a');
	});
});

describe('what it says, and where (doc 13 §7)', () => {
	it('puts a skip in the app’s toast, in words resolved when it shows', async () => {
		toasts.reset();
		player.reset({ target, createAudio: () => audio as unknown as HTMLAudioElement });
		await seed(['a', 'b']);
		audio.script = ['unsupported'];

		player.playTracks(['a', 'b'], 'a', { kind: 'library' });

		await vi.waitFor(() => expect(toasts.current?.kind).toBe('notice'));
		const shown = toasts.current;
		expect(shown?.kind === 'notice' ? shown.message() : '').toBe(
			m['common.toast.music_skipped']({ title: 'Song a' })
		);
		toasts.reset();
	});
});
