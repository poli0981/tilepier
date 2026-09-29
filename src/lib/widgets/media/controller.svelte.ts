import { keyAction, targetOf } from './keys';
import {
	loadPrefs,
	loadResume,
	resumeKey,
	savePrefs,
	savePrefsNow,
	saveResume,
	saveResumeNow
} from './resume';
import { canFullscreen, canPip, leaveScreens, toggleFullscreen, togglePip } from './screen';
import {
	SAVE_EVERY_MS,
	shouldResume,
	troubleOf,
	type TpMediaPrefs,
	type TpResume
} from './service';
import { videoSession, type TpVideoSession } from './session';
import { media, type TpMediaFile } from './store.svelte';

type TpPhase = 'loading' | 'ready' | 'unsupported' | 'unreadable';

/**
 * One video's playback (doc 09 §3): the state `TpMediaPlayer` draws, and
 * everything that happens to the element. One per file — the detail mounts a
 * player per file, and picture-in-picture ends with it (owner decision Q2).
 *
 * **Never a silent black box** (doc 17 §4a):
 * - a format this browser does not play says so;
 * - a local file that fails to read or decode is read once more (from its
 *   handle, when it has one), then says it changed or moved;
 * - sound with no picture plays, and says that.
 *
 * **One sound at a time.** The video claims `core/playback` when it starts
 * playing, not before `play()`, so a file this browser cannot play never takes
 * the sound from the music player (`session.ts`).
 *
 * **Keys where the reader is** (Week 7 plan S16, `keys.ts`). The video takes
 * focus when it loads, and a key the player answers stops at the player: Space
 * does not scroll the detail, and nothing underneath hears it. Escape is never
 * the player's (`ui/dialog-keys.ts`).
 *
 * **It picks a video up where it was left** (doc 09 §3, `resume.ts`), past
 * the first five seconds and short of the last five, with the reader's volume;
 * "Start over" is one press. Where it is gets written every ten seconds of
 * play, and at once on a pause, a seek, the end (back to the start), a hidden
 * or closing page — and when the player goes.
 *
 * **The listeners are its own**, added here and removed in `dispose`. What
 * happens when the player goes — keep the place, pause, let go of the sound,
 * the Media Session and both screens, release the object URL — does not wait
 * on events Svelte may already have unhooked, and reads the place before the
 * element lets go of the file (Week 7 plan §3.1).
 */
export class TpVideoController {
	phase = $state<TpPhase>('loading');
	audioOnly = $state(false);
	playing = $state(false);
	/** The browser would not start without a gesture: "press play". */
	blocked = $state(false);
	positionMs = $state(0);
	durationMs = $state(0);
	rate = $state(1);
	volume = $state(1);
	muted = $state(false);
	pipAvailable = $state(false);
	inPip = $state(false);
	inFullscreen = $state(false);
	/** Where the player picked the video up, for "Start over"; `null` once the
	 *  reader moves it themselves. */
	resumedFromMs = $state<number | null>(null);
	readonly fullscreenAvailable: boolean;

	readonly #video: HTMLVideoElement;
	readonly #box: HTMLElement;
	readonly #file: TpMediaFile;
	readonly #session: TpVideoSession;
	#listeners: [EventTarget, string, EventListener][] = [];
	#url: string | null = null;
	#retried = false;
	#focused = false;
	#disposed = false;
	readonly #restored: Promise<void>;
	/** The video's resume key; `null` when it has none, and nothing is kept. */
	#key: string | null = null;
	/** Where to go once the length is known: a resume, or back after a retry. */
	#pendingMs: number | null = null;
	#pendingIsResume = false;
	#prefs: TpMediaPrefs = { volume: 1, muted: false };
	#lastSaved = 0;

	constructor(video: HTMLVideoElement, box: HTMLElement, file: TpMediaFile) {
		this.#video = video;
		this.#box = box;
		this.#file = file;
		this.#session = videoSession(video, file.name);
		this.fullscreenAvailable = canFullscreen(video);

		this.#on(video, 'loadedmetadata', () => this.#onMetadata());
		this.#on(video, 'playing', () => this.#onPlaying());
		this.#on(video, 'pause', () => this.#onPause());
		this.#on(video, 'ended', () => this.#onEnded());
		this.#on(video, 'timeupdate', () => this.#onTime());
		this.#on(video, 'volumechange', () => {
			this.volume = video.volume;
			this.muted = video.muted;
		});
		this.#on(video, 'ratechange', () => {
			this.rate = video.playbackRate;
			this.#session.position();
		});
		this.#on(video, 'seeked', () => {
			this.#session.position();
			this.#save();
		});
		this.#on(video, 'error', () => void this.#onError());
		this.#on(video, 'enterpictureinpicture', () => {
			this.inPip = true;
		});
		this.#on(video, 'leavepictureinpicture', () => {
			this.inPip = false;
		});
		this.#on(document, 'fullscreenchange', () => {
			this.inFullscreen = document.fullscreenElement === box;
		});
		this.#on(box, 'keydown', (event) => this.#onKey(event as KeyboardEvent));
		// A hidden page may be on its way out too: both write as a closing page.
		this.#on(document, 'visibilitychange', () => {
			if (document.visibilityState === 'hidden') this.#saveOnExit();
		});
		this.#on(window, 'pagehide', () => this.#saveOnExit());

		this.#restored = this.#restore();
		void this.#load();
	}

	/** The player is going: silence, and let go of everything it held. */
	dispose(): void {
		// First, while the element still holds the file and knows where it is.
		this.#save();
		this.#disposed = true;
		for (const [target, type, listener] of this.#listeners) {
			target.removeEventListener(type, listener);
		}
		this.#listeners = [];
		this.#video.pause();
		this.#session.leave();
		leaveScreens(this.#box, this.#video);
		this.#video.removeAttribute('src');
		this.#video.load();
		if (this.#url !== null) URL.revokeObjectURL(this.#url);
		this.#url = null;
		this.playing = false;
		media.report(this.positionMs, this.durationMs, false);
	}

	/**
	 * By what the button says, not by `paused`: between play() and `playing`
	 * the element is no longer paused while the button still says "Play", and
	 * a press then means play (found by the suite under load, 2026-09-29).
	 */
	toggle(): void {
		if (this.playing) this.#video.pause();
		else void this.play();
	}

	async play(): Promise<void> {
		try {
			await this.#video.play();
			this.blocked = false;
		} catch (error) {
			// AbortError is a newer source taking over; a format it cannot play
			// fires `error` as well, and is answered there.
			if ((error as { name?: unknown }).name === 'NotAllowedError') this.blocked = true;
		}
	}

	seekTo(ms: number): void {
		this.resumedFromMs = null;
		this.#video.currentTime = ms / 1000;
	}

	/** Back to the beginning of a video the player picked up part-way. */
	startOver(): void {
		this.seekTo(0);
	}

	seekBy(seconds: number): void {
		this.resumedFromMs = null;
		const video = this.#video;
		const end = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
		video.currentTime = Math.min(end, Math.max(0, video.currentTime + seconds));
	}

	setVolume(next: number): void {
		const volume = Math.min(1, Math.max(0, Math.round(next * 100) / 100));
		this.#video.volume = volume;
		this.#video.muted = volume === 0;
	}

	toggleMute(): void {
		this.#video.muted = !this.#video.muted;
	}

	setRate(next: number): void {
		this.#video.playbackRate = next;
	}

	togglePip(): void {
		void togglePip(this.#video);
	}

	toggleFullscreen(): void {
		void toggleFullscreen(this.#box, this.#video);
	}

	#on(target: EventTarget, type: string, listener: EventListener): void {
		target.addEventListener(type, listener);
		this.#listeners.push([target, type, listener]);
	}

	/** Reads back the reader's volume and this video's place, before it plays. */
	async #restore(): Promise<void> {
		const { name, size } = this.#file;
		const [key, prefs] = await Promise.all([resumeKey(name, size), loadPrefs()]);
		if (prefs !== null && !this.#disposed) {
			this.#prefs = prefs;
			this.#video.volume = prefs.volume;
			this.#video.muted = prefs.muted;
		}
		this.#key = key;
		const saved = key === null ? null : await loadResume(key);
		if (saved !== null && shouldResume(saved.positionMs, saved.durationMs)) {
			this.#pendingMs = saved.positionMs;
			this.#pendingIsResume = true;
		}
	}

	/**
	 * What to keep for where the video is, or `null` for nothing to keep: no
	 * key, nothing playable, or a place still to be gone to — until then the
	 * element is at 0:00, and that is not where the reader was.
	 */
	#place(positionMs: number): { key: string; place: TpResume } | null {
		const key = this.#key;
		if (key === null || this.phase !== 'ready' || this.#pendingMs !== null) return null;
		const { name, size } = this.#file;
		return { key, place: { name, size, positionMs, durationMs: this.durationMs } };
	}

	/** The volume and mute, when they changed since they were last kept. */
	#changedPrefs(): TpMediaPrefs | null {
		const prefs = { volume: this.#video.volume, muted: this.#video.muted };
		if (prefs.volume === this.#prefs.volume && prefs.muted === this.#prefs.muted) return null;
		this.#prefs = prefs;
		return prefs;
	}

	/** Keeps where the video is, and the volume when it changed. */
	#save(positionMs = Math.round(this.#video.currentTime * 1000)): void {
		const kept = this.#place(positionMs);
		if (kept === null) return;
		this.#lastSaved = Date.now();
		void saveResume(kept.key, kept.place);
		const prefs = this.#changedPrefs();
		if (prefs !== null) void savePrefs(prefs);
	}

	/** `#save` for a page on its way out: written and committed before the
	 *  handler returns, or the closing page takes the write with it. */
	#saveOnExit(): void {
		const kept = this.#place(Math.round(this.#video.currentTime * 1000));
		if (kept === null) return;
		this.#lastSaved = Date.now();
		saveResumeNow(kept.key, kept.place);
		const prefs = this.#changedPrefs();
		if (prefs !== null) savePrefsNow(prefs);
	}

	/** Reads the file — again from its handle when there is one — and plays. */
	async #load(): Promise<void> {
		await this.#restored;
		let blob: Blob = this.#file.file;
		if (this.#file.handle !== undefined) {
			try {
				blob = await this.#file.handle.getFile();
			} catch {
				// The grant or the file went away; the File in hand may still read.
			}
		}
		if (this.#disposed) return;
		if (this.#url !== null) URL.revokeObjectURL(this.#url);
		this.#url = URL.createObjectURL(blob);
		this.#video.src = this.#url;
		await this.play();
	}

	#report(): void {
		media.report(this.positionMs, this.durationMs, this.playing);
	}

	#onKey(event: KeyboardEvent): void {
		const action = keyAction(event, targetOf(event.target));
		if (action === null || this.phase !== 'ready') return;
		event.preventDefault();
		event.stopPropagation();
		if (action.kind === 'toggle') this.toggle();
		else if (action.kind === 'seek') this.seekBy(action.bySeconds);
		else if (action.kind === 'volume') this.setVolume(this.#video.volume + action.by);
		else if (action.kind === 'mute') this.toggleMute();
		else this.toggleFullscreen();
	}

	#onMetadata(): void {
		const video = this.#video;
		this.durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
		this.audioOnly = video.videoWidth === 0;
		this.pipAvailable = canPip(video);
		const at = this.#pendingMs;
		const resuming = this.#pendingIsResume;
		this.#pendingMs = null;
		this.#pendingIsResume = false;
		if (at !== null && (!resuming || shouldResume(at, this.durationMs))) {
			video.currentTime = at / 1000;
			this.positionMs = at;
			if (resuming) this.resumedFromMs = at;
		}
		this.phase = 'ready';
		if (!this.#focused) {
			// Keys work from the moment there is something to play, without a
			// click into the player first.
			this.#focused = true;
			video.focus({ preventScroll: true });
		}
		this.#session.position();
		this.#report();
	}

	#onPlaying(): void {
		this.playing = true;
		this.blocked = false;
		this.#session.claim();
		this.#session.state(true);
		this.#report();
	}

	#onPause(): void {
		this.playing = false;
		this.#session.state(false);
		this.#report();
		this.#save();
	}

	/** Watched to the end: the next time starts at the start (doc 09 §3). */
	#onEnded(): void {
		this.playing = false;
		this.#session.state(false);
		this.#report();
		this.#save(0);
	}

	#onTime(): void {
		this.positionMs = Math.round(this.#video.currentTime * 1000);
		this.#report();
		if (this.playing && Date.now() - this.#lastSaved >= SAVE_EVERY_MS) this.#save();
	}

	async #onError(): Promise<void> {
		const trouble = troubleOf(this.#video.error?.code);
		if (trouble === 'unsupported') {
			this.phase = 'unsupported';
		} else if (trouble === 'retry' && !this.#retried) {
			this.#retried = true;
			// Back to where it was once the fresh read is in, not to 0:00.
			if (this.phase === 'ready') this.#pendingMs ??= this.positionMs;
			await this.#load();
		} else if (trouble === 'retry') {
			this.phase = 'unreadable';
		}
	}
}
