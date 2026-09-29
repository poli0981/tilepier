import { untrack } from 'svelte';
import {
	clearSession,
	pageSession,
	writeSessionHandlers,
	writeSessionMetadata,
	writeSessionPosition,
	writeSessionState,
	type TpMediaSession
} from '$lib/core/media-session';
import { claimPlayback, playbackOwner, releasePlayback } from '$lib/core/playback';
import { db as defaultDb, type TpDb, type TpTrack } from '$lib/core/storage/db';
import { m } from '$lib/paraglide/messages';
import { deck } from '$lib/stores/deck.svelte';
import { toasts } from '$lib/stores/toast.svelte';
import { fileAt, loadMusicRoot } from './library';
import {
	buildQueue,
	currentId,
	EMPTY_QUEUE,
	readPosition,
	readQueue,
	reshuffle,
	RESTART_AFTER_MS,
	stepIndex,
	type TpQueue,
	type TpQueueSource,
	type TpRepeat,
	type TpSavedPosition
} from './service';

/**
 * The music player — one `HTMLAudioElement` for the whole app (doc 09 §2).
 *
 * **A module singleton, not a component** (Week 7 plan S2). The element has to
 * outlive the detail closing, the tile being unmounted by a navigation, and
 * the tile crashing and being remounted by its error boundary; a component
 * owns none of those lifetimes and a module owns all of them. It is created on
 * the first play and **never replaced**: Safari unlocks programmatic `play()`
 * per element, for the element a gesture first started, so a new element
 * would need a new gesture. It dies with the page — a reload, a locale switch,
 * a service-worker update — and the saved position brings it back, paused.
 *
 * **It stops itself when its tile leaves the deck** (plan S3). Tile unmount is
 * not that signal — the tile also unmounts when the reader opens `/w/music` or
 * goes to `/settings` — and `deck.reset()` runs from `/settings`, where the
 * deck page is not mounted to notice. So the player watches the deck store:
 * while no tile of `music` is on it, nothing may play. Nothing can start
 * playing without one either: `/w/music` renders its detail only for a tile
 * that exists.
 *
 * **What a failure means depends on where it came from** (plan S12, as the
 * review corrected it):
 * - `NotAllowedError` from *reading the folder* is a lapsed grant: the tile
 *   asks for it again, and nothing is marked or skipped.
 * - `NotAllowedError` from `play()` is the browser refusing to start without a
 *   gesture: "press play", again with nothing marked.
 * - `AbortError` from `play()` is a newer source taking over — the reader
 *   pressed next twice. It is not a failure at all.
 * - A file gone from its folder is marked `missing`; a format this browser
 *   cannot decode is marked `unsupported`; a decode error is retried once from
 *   a fresh read (a file edited mid-play goes unreadable) before `unreadable`.
 *   Each of those skips to the next track — and **three in a row stop** the
 *   player, or a library whose drive was unplugged would spin through every
 *   track, forever on repeat-all. `playing` resets the count.
 *
 * **The OS's media keys and lock screen drive it through the Media Session**
 * (doc 09 §2) — written only while this player holds `core/playback`'s claim,
 * which every start takes, so the video player can have the session when it
 * plays and this one never writes over it. Stopping clears it: a key press
 * must not start music for a tile that has left the deck.
 *
 * Methods report through state rather than throwing: the tile's error boundary
 * catches render and effect errors, not a click handler's.
 */

type TpPlayerStatus =
	| 'idle'
	| 'loading'
	| 'playing'
	| 'paused'
	/** The browser would not start without a gesture: press play. */
	| 'blocked'
	/** The folder grant lapsed: re-link, then play resumes. */
	| 'permission';

export type TpPlayerNotice = { kind: 'skipped'; title: string } | { kind: 'stopped' };

/** How often a playing position is written, at most (doc 09 §2, plan S10). */
export const SAVE_EVERY_MS = 10_000;

/** Consecutive failures before the player gives up (plan S12). */
const MAX_FAILURES = 3;

const POSITION_KEY = 'music';
const QUEUE_KEY = 'music:queue';

interface TpSeams {
	target: TpDb;
	createAudio: () => HTMLAudioElement;
	now: () => number;
	random: () => number;
	notify: (notice: TpPlayerNotice) => void;
	session: () => TpMediaSession | null;
}

/**
 * The player's notices go to the app's one toast (doc 13 §7): it outlives the
 * tile and the detail, so a skip can happen with neither on screen, and the
 * toast is the one place that is always there. The text is resolved when the
 * toast renders, in whatever language the reader has then.
 */
function toast(notice: TpPlayerNotice): void {
	toasts.show({
		kind: 'notice',
		message: () =>
			notice.kind === 'skipped'
				? m['common.toast.music_skipped']({ title: notice.title })
				: m['common.toast.music_stopped']()
	});
}

function defaultSeams(): TpSeams {
	return {
		target: defaultDb,
		createAudio: () => new Audio(),
		now: () => Date.now(),
		random: Math.random,
		notify: toast,
		session: pageSession
	};
}

function named(error: unknown, name: string): boolean {
	return typeof error === 'object' && error !== null && (error as { name?: unknown }).name === name;
}

class TpPlayer {
	current = $state.raw<TpTrack | null>(null);
	status = $state<TpPlayerStatus>('idle');
	positionMs = $state(0);
	durationMs = $state(0);
	queue = $state.raw<TpQueue>(EMPTY_QUEUE);
	shuffle = $state(false);
	repeat = $state<TpRepeat>('off');
	volume = $state(1);

	#seams: TpSeams = defaultSeams();
	#audio: HTMLAudioElement | null = null;
	#url: string | null = null;
	/** Bumped by every load, so a slow read cannot land on top of a newer one. */
	#token = 0;
	#failures = 0;
	#retried = false;
	#pendingSeekMs: number | null = null;
	/** The Media Session's artwork: one object URL, shared by an album's tracks. */
	#cover: { id: string; src: string; type: string } | null = null;
	#lastSaved = 0;
	#restoring: Promise<void> | null = null;
	#hadTile = false;
	#listeners = new Set<(track: TpTrack) => void>();
	#disposeWatcher: (() => void) | null = null;
	#detachPage: (() => void) | null = null;

	constructor() {
		this.#watchDeck();
	}

	/** True while the source it would play is already in the element. */
	get loaded(): boolean {
		return this.#url !== null;
	}

	get hasNext(): boolean {
		return stepIndex(this.queue, 1, this.repeat) !== null;
	}

	/** Tells `fn` about a track the player changed — marked, or its duration
	 *  learned — so a list showing it can update. Returns the unsubscriber. */
	onTrackChange(fn: (track: TpTrack) => void): () => void {
		this.#listeners.add(fn);
		return () => this.#listeners.delete(fn);
	}

	/**
	 * Reads back where the player was, once per page, **paused** — doc 09 §2:
	 * never autoplay on load. The audio itself is not read until play is
	 * pressed.
	 */
	restore(): Promise<void> {
		this.#restoring ??= (async () => {
			try {
				const [position, queue] = await Promise.all([
					this.#seams.target.playback.get(POSITION_KEY),
					this.#seams.target.playback.get(QUEUE_KEY)
				]);
				const savedQueue = readQueue(queue?.state);
				if (savedQueue !== null) this.queue = savedQueue;
				const saved = readPosition(position?.state);
				if (saved !== null) await this.#adopt(saved);
			} catch {
				// A player that starts empty beats one that does not start.
			}
		})();
		return this.#restoring;
	}

	async #adopt(saved: TpSavedPosition): Promise<void> {
		this.shuffle = saved.shuffle;
		this.repeat = saved.repeat;
		this.volume = saved.volume;
		if (saved.trackId === null || this.current !== null) return;
		const track = await this.#seams.target.tracks.get(saved.trackId);
		if (track === undefined) return;
		this.current = track;
		this.positionMs = saved.positionMs;
		this.durationMs = track.durationMs ?? 0;
		this.#pendingSeekMs = saved.positionMs;
		this.status = 'paused';
	}

	/** Plays `startId` from a queue of `trackIds` — the reader chose it. */
	playTracks(trackIds: readonly string[], startId: string, source: TpQueueSource): void {
		if (trackIds.length === 0) return;
		this.queue = buildQueue(trackIds, startId, source, this.shuffle, this.#seams.random);
		this.#failures = 0;
		void this.#saveQueue();
		void this.#load(currentId(this.queue), true);
	}

	play(): void {
		const track = this.current;
		if (track === null) return;
		if (this.#url === null) {
			// A restored track has not been read yet: read it, and start it where
			// the reader left it rather than at 0:00.
			void this.#load(track.id, true, this.#pendingSeekMs ?? 0);
			return;
		}
		void this.#start();
	}

	pause(): void {
		this.#audio?.pause();
	}

	toggle(): void {
		if (this.status === 'playing' || this.status === 'loading') this.pause();
		else this.play();
	}

	next(): void {
		const index = stepIndex(this.queue, 1, this.repeat);
		if (index === null) return;
		this.#moveTo(index);
	}

	/** Back to the start of the track past `RESTART_AFTER_MS`, else the one
	 *  before — and the start of this one when there is nothing before. */
	prev(): void {
		const index = stepIndex(this.queue, -1, this.repeat);
		if (this.positionMs > RESTART_AFTER_MS || index === null) {
			this.seek(0);
			return;
		}
		this.#moveTo(index);
	}

	seek(ms: number): void {
		const target = Math.max(0, ms);
		this.positionMs = target;
		if (this.#audio !== null && this.#url !== null) this.#audio.currentTime = target / 1000;
		else this.#pendingSeekMs = target;
		this.#sessionPosition();
		void this.#savePosition();
	}

	setShuffle(on: boolean): void {
		this.shuffle = on;
		this.queue = reshuffle(this.queue, on, this.#seams.random);
		void this.#saveQueue();
		void this.#savePosition();
	}

	/** off → all → one → off. */
	cycleRepeat(): void {
		this.repeat = this.repeat === 'off' ? 'all' : this.repeat === 'all' ? 'one' : 'off';
		void this.#savePosition();
	}

	setVolume(volume: number): void {
		this.volume = Math.min(1, Math.max(0, volume));
		if (this.#audio !== null) this.#audio.volume = this.volume;
		void this.#savePosition();
	}

	/** Silence, and let go of the Media Session — the tile left the deck. */
	stop(): void {
		this.#token += 1;
		this.#audio?.pause();
		if (this.status !== 'idle') this.status = this.current === null ? 'idle' : 'paused';
		this.#leaveSession();
		void this.#savePosition();
	}

	/* ─────────────────────────────────────────────────────────── loading */

	#moveTo(index: number): void {
		this.queue = { ...this.queue, index };
		void this.#saveQueue();
		void this.#load(currentId(this.queue), true);
	}

	/** Reads a track and puts it in the element — from `resumeAtMs`, which is
	 *  the saved position for a restored track and the start for every other. */
	async #load(id: string | undefined, autoplay: boolean, resumeAtMs = 0): Promise<void> {
		const token = (this.#token += 1);
		this.#retried = false;
		if (id === undefined) return;

		const track = await this.#seams.target.tracks.get(id);
		if (token !== this.#token) return;
		if (track === undefined) {
			// A replace or a removal took it out of the library; the queue still
			// named it (plan S25). Skip it like a missing file.
			await this.#failed(undefined, token);
			return;
		}

		this.current = track;
		this.status = 'loading';
		this.positionMs = resumeAtMs;
		this.durationMs = track.durationMs ?? 0;
		this.#pendingSeekMs = resumeAtMs > 0 ? resumeAtMs : null;
		void this.#savePosition();

		let blob: Blob;
		try {
			blob = await this.#read(track);
		} catch (error) {
			if (token !== this.#token) return;
			if (named(error, 'NotAllowedError')) {
				this.status = 'permission';
				return;
			}
			await this.#mark(track, 'missing');
			await this.#failed(track, token);
			return;
		}
		if (token !== this.#token) return;

		this.#setSource(blob);
		if (autoplay) await this.#start();
		else this.status = 'paused';
	}

	/** The bytes: from the folder on path A, from Dexie on path B. */
	async #read(track: TpTrack): Promise<Blob> {
		if (track.source === 'blob') {
			const row = await this.#seams.target.trackBlobs.get(track.id);
			if (row === undefined) throw new DOMException('not in the library', 'NotFoundError');
			return row.blob;
		}
		const root = await loadMusicRoot(this.#seams.target);
		if (root === null || track.relPath === undefined) {
			throw new DOMException('no folder', 'NotFoundError');
		}
		return fileAt(root, track.relPath);
	}

	#setSource(blob: Blob): void {
		const audio = this.#element();
		const previous = this.#url;
		this.#url = URL.createObjectURL(blob);
		audio.src = this.#url;
		if (previous !== null) URL.revokeObjectURL(previous);
	}

	async #start(): Promise<void> {
		const audio = this.#element();
		const token = this.#token;
		claimPlayback('music', () => this.#yield());
		void this.#publish();
		try {
			await audio.play();
		} catch (error) {
			if (token !== this.#token || named(error, 'AbortError')) return;
			if (named(error, 'NotAllowedError')) {
				this.status = 'blocked';
				return;
			}
			// Anything else surfaces as the element's own `error` event too, and
			// is handled there — once.
		}
	}

	/** Another player claimed the sound (core/playback). */
	#yield(): void {
		this.#audio?.pause();
	}

	/* ────────────────────────────────────────────────── element and events */

	#element(): HTMLAudioElement {
		if (this.#audio !== null) return this.#audio;
		const audio = this.#seams.createAudio();
		audio.preload = 'auto';
		audio.volume = this.volume;
		audio.addEventListener('playing', () => this.#onPlaying());
		audio.addEventListener('pause', () => this.#onPause());
		audio.addEventListener('ended', () => void this.#onEnded());
		audio.addEventListener('timeupdate', () => this.#onTime());
		audio.addEventListener('loadedmetadata', () => this.#onMetadata());
		audio.addEventListener('durationchange', () => this.#onMetadata());
		audio.addEventListener('error', () => void this.#onError());
		this.#audio = audio;
		this.#attachPage();
		return audio;
	}

	#onPlaying(): void {
		this.status = 'playing';
		this.#failures = 0;
		this.#sessionState('playing');
	}

	#onPause(): void {
		if (this.status === 'playing') this.status = 'paused';
		this.#sessionState('paused');
		void this.#savePosition();
	}

	async #onEnded(): Promise<void> {
		if (this.repeat === 'one') {
			this.seek(0);
			await this.#start();
			return;
		}
		const index = stepIndex(this.queue, 1, this.repeat);
		if (index === null) {
			// The end of the queue: stop on its last track, back at its start.
			this.seek(0);
			this.status = 'paused';
			return;
		}
		this.#moveTo(index);
	}

	#onTime(): void {
		const audio = this.#audio;
		if (audio === null || this.#pendingSeekMs !== null) return;
		this.positionMs = Math.round(audio.currentTime * 1000);
		if (this.#seams.now() - this.#lastSaved >= SAVE_EVERY_MS) void this.#savePosition();
	}

	#onMetadata(): void {
		const audio = this.#audio;
		const track = this.current;
		if (audio === null || track === null) return;
		if (Number.isFinite(audio.duration) && audio.duration > 0) {
			this.durationMs = Math.round(audio.duration * 1000);
			// doc 22 §S7: the one file the scan could not time without reading it
			// whole learns its length here, once, and keeps it.
			if (track.durationMs === undefined) {
				void this.#update({ ...track, durationMs: this.durationMs });
			}
		}
		if (this.#pendingSeekMs !== null) {
			audio.currentTime = this.#pendingSeekMs / 1000;
			this.positionMs = this.#pendingSeekMs;
			this.#pendingSeekMs = null;
		}
		this.#sessionPosition();
	}

	async #onError(): Promise<void> {
		const track = this.current;
		const code = this.#audio?.error?.code;
		if (track === null || code === undefined || code === 1) return; // 1: aborted, by us
		const token = this.#token;

		if (code === 4) {
			await this.#mark(track, 'unsupported');
			await this.#failed(track, token);
			return;
		}
		// A decode error, once, may be a file that changed under a snapshot the
		// element was reading: read it again before calling it unreadable.
		if (!this.#retried && track.source === 'fsa') {
			this.#retried = true;
			try {
				this.#setSource(await this.#read(track));
				await this.#start();
				return;
			} catch {
				// Fall through to the mark.
			}
		}
		await this.#mark(track, 'unreadable');
		await this.#failed(track, token);
	}

	/** Counts a failure, then skips — or stops, at `MAX_FAILURES` in a row. */
	async #failed(track: TpTrack | undefined, token: number): Promise<void> {
		if (token !== this.#token) return;
		this.#failures += 1;
		if (this.#failures >= MAX_FAILURES) {
			this.#failures = 0;
			this.#audio?.pause();
			this.status = this.current === null ? 'idle' : 'paused';
			this.#seams.notify({ kind: 'stopped' });
			return;
		}
		this.#seams.notify({ kind: 'skipped', title: track?.title ?? '' });
		const index = stepIndex(this.queue, 1, this.repeat);
		if (index === null) {
			this.status = 'paused';
			return;
		}
		this.#moveTo(index);
	}

	async #mark(track: TpTrack, mark: 'missing' | 'unsupported' | 'unreadable'): Promise<void> {
		await this.#update(
			mark === 'missing' ? { ...track, missing: true } : { ...track, error: mark }
		);
	}

	async #update(track: TpTrack): Promise<void> {
		try {
			await this.#seams.target.tracks.put(track);
		} catch {
			// The mark is a courtesy to the next play, not something to crash over.
		}
		if (this.current?.id === track.id) this.current = track;
		for (const fn of this.#listeners) fn(track);
	}

	/* ──────────────────────────────────────────────────── Media Session */

	/** The page's session while this player holds the claim, else nothing. */
	#session(): TpMediaSession | null {
		return playbackOwner() === 'music' ? this.#seams.session() : null;
	}

	/**
	 * Fills the session for the current track: the keys first, then the words
	 * and the cover once the cover is read. `#start` calls it right after the
	 * claim that makes the session this player's to fill.
	 */
	async #publish(): Promise<void> {
		const track = this.current;
		const session = this.#session();
		if (track === null || session === null) return;
		writeSessionHandlers(session, {
			play: () => this.play(),
			pause: () => this.pause(),
			previoustrack: () => this.prev(),
			nexttrack: () => this.next(),
			seekto: (details) => {
				if (details.seekTime !== undefined) this.seek(details.seekTime * 1000);
			}
		});

		const id = track.coverId;
		const blob = id === undefined || this.#cover?.id === id ? undefined : await this.#coverBlob(id);
		// The reader may have moved on, or the video player claimed the sound.
		if (this.current?.id !== track.id || this.#session() !== session) return;
		if (id !== undefined && blob !== undefined) {
			this.#dropCover();
			this.#cover = { id, src: URL.createObjectURL(blob), type: blob.type };
		}
		const cover = this.#cover;
		writeSessionMetadata(session, {
			title: track.title,
			artist: track.artist || m['widget.music.unknown_artist'](),
			album: track.album,
			artwork: cover !== null && cover.id === id ? { src: cover.src, type: cover.type } : undefined
		});
	}

	async #coverBlob(id: string): Promise<Blob | undefined> {
		try {
			return (await this.#seams.target.trackBlobs.get(id))?.blob;
		} catch {
			return undefined;
		}
	}

	#dropCover(): void {
		if (this.#cover !== null) URL.revokeObjectURL(this.#cover.src);
		this.#cover = null;
	}

	#sessionState(state: MediaSessionPlaybackState): void {
		const session = this.#session();
		if (session === null) return;
		writeSessionState(session, state);
		writeSessionPosition(session, this.durationMs, this.positionMs);
	}

	#sessionPosition(): void {
		const session = this.#session();
		if (session !== null) writeSessionPosition(session, this.durationMs, this.positionMs);
	}

	/** Clears the session if it is this player's, and lets go of the claim. */
	#leaveSession(): void {
		const session = this.#session();
		if (session !== null) clearSession(session);
		releasePlayback('music');
		this.#dropCover();
	}

	/* ─────────────────────────────────────────────────────── persistence */

	async #savePosition(): Promise<void> {
		this.#lastSaved = this.#seams.now();
		const state: TpSavedPosition = {
			trackId: this.current?.id ?? null,
			positionMs: Math.max(0, Math.round(this.positionMs)),
			shuffle: this.shuffle,
			repeat: this.repeat,
			volume: this.volume
		};
		try {
			await this.#seams.target.playback.put({
				id: POSITION_KEY,
				updatedAt: this.#seams.now(),
				state
			});
		} catch {
			// A full disk costs the resume point, nothing else.
		}
	}

	/** Only when the queue changes: it can hold a library's worth of ids. */
	async #saveQueue(): Promise<void> {
		const { source, trackIds, order, index } = this.queue;
		try {
			await this.#seams.target.playback.put({
				id: QUEUE_KEY,
				updatedAt: this.#seams.now(),
				state: { source, trackIds: [...trackIds], order: [...order], index }
			});
		} catch {
			// As above.
		}
	}

	/** doc 04 §6's flush points, for the position: a closing or hidden page. */
	#attachPage(): void {
		if (typeof window === 'undefined') return;
		const flush = () => void this.#savePosition();
		const onVisibility = () => {
			if (document.visibilityState === 'hidden') flush();
		};
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', onVisibility);
		this.#detachPage = () => {
			window.removeEventListener('pagehide', flush);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	}

	#watchDeck(): void {
		this.#disposeWatcher = $effect.root(() => {
			$effect(() => {
				// Tracks the deck and nothing else: `stop()` reads player state,
				// which must not become a dependency of this effect.
				const hasTile = deck.loaded && deck.tiles.some((tile) => tile.widgetId === 'music');
				untrack(() => {
					if (this.#hadTile && !hasTile) this.stop();
					this.#hadTile = hasTile;
				});
			});
		});
	}

	/** Test seam: a fresh player over `seams`. Never called in production. */
	reset(seams: Partial<TpSeams> = {}): void {
		this.#token += 1;
		this.#audio?.pause();
		if (this.#url !== null) URL.revokeObjectURL(this.#url);
		this.#leaveSession();
		this.#detachPage?.();
		this.#disposeWatcher?.();
		this.#seams = { ...defaultSeams(), ...seams };
		this.#audio = null;
		this.#url = null;
		this.#detachPage = null;
		this.#failures = 0;
		this.#retried = false;
		this.#pendingSeekMs = null;
		this.#lastSaved = 0;
		this.#restoring = null;
		this.#hadTile = false;
		// Listeners stay: they are the collection store's wiring, made once at
		// import, not state of the player being reset.
		this.current = null;
		this.status = 'idle';
		this.positionMs = 0;
		this.durationMs = 0;
		this.queue = EMPTY_QUEUE;
		this.shuffle = false;
		this.repeat = 'off';
		this.volume = 1;
		this.#watchDeck();
	}
}

export const player = new TpPlayer();
