<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { troubleOf } from './service';
	import { videoSession, type TpVideoSession } from './session';
	import { media, type TpMediaFile } from './store.svelte';
	import TpMediaControls from './TpMediaControls.svelte';

	/**
	 * The video itself (doc 09 §3): one `<video>`, owned here and nowhere else.
	 * The detail mounts one per file, so picture-in-picture ends when the detail
	 * closes (owner decision Q2).
	 *
	 * **Never a silent black box** (doc 09 §3, doc 17 §4a):
	 * - a format this browser does not play says so, with the formats that
	 *   play almost everywhere;
	 * - a local file that changed or moved under the reader is read once more,
	 *   then says so;
	 * - sound with no picture this browser can show plays, and says that.
	 *
	 * **The teardown carries everything it needs.** Svelte has removed the
	 * element's listeners by the time an effect's teardown runs (Week 7 plan
	 * §3.1), so leaving pauses, lets go of the Media Session and releases the
	 * object URL itself, with the element held in the effect's closure.
	 */
	interface Props {
		file: TpMediaFile;
	}

	let { file }: Props = $props();

	type TpPhase = 'loading' | 'ready' | 'unsupported' | 'unreadable';

	let video = $state<HTMLVideoElement | null>(null);
	let phase = $state<TpPhase>('loading');
	let audioOnly = $state(false);
	let playing = $state(false);
	let blocked = $state(false);
	let positionMs = $state(0);
	let durationMs = $state(0);
	let rate = $state(1);
	let volume = $state(1);
	let muted = $state(false);

	let session: TpVideoSession | null = null;
	let url: string | null = null;
	let retried = false;

	$effect(() => {
		const element = video;
		const source = file;
		if (element === null) return;
		const current = videoSession(element, source.name);
		session = current;
		void load(element, source);

		return () => {
			element.pause();
			current.leave();
			if (session === current) session = null;
			element.removeAttribute('src');
			element.load();
			if (url !== null) URL.revokeObjectURL(url);
			url = null;
			media.report(positionMs, durationMs, false);
		};
	});

	/** Reads the file — again from its handle when there is one — and plays. */
	async function load(element: HTMLVideoElement, source: TpMediaFile): Promise<void> {
		let blob: Blob = source.file;
		if (source.handle !== undefined) {
			try {
				blob = await source.handle.getFile();
			} catch {
				// The grant or the file went away; the File in hand may still read.
			}
		}
		if (video !== element || file !== source) return;
		if (url !== null) URL.revokeObjectURL(url);
		url = URL.createObjectURL(blob);
		element.src = url;
		await play();
	}

	async function play(): Promise<void> {
		const element = video;
		if (element === null) return;
		try {
			await element.play();
			blocked = false;
		} catch (error) {
			// A browser that will not start without a gesture: say "press play".
			// AbortError is a newer source taking over; a format it cannot play
			// fires `error` as well, and is handled there.
			if ((error as { name?: unknown }).name === 'NotAllowedError') blocked = true;
		}
	}

	function toggle(): void {
		if (video === null) return;
		// By what the button says, not by `paused`: between play() and `playing`
		// the element is no longer paused while the button still says "Play",
		// and a press then means play — not a pause of a video that never showed
		// it had started (found by the suite under load, 2026-09-29).
		if (playing) video.pause();
		else void play();
	}

	function report(): void {
		media.report(positionMs, durationMs, playing);
	}

	function onLoadedMetadata(): void {
		if (video === null) return;
		durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
		audioOnly = video.videoWidth === 0;
		phase = 'ready';
		session?.position();
		report();
	}

	function onPlaying(): void {
		playing = true;
		blocked = false;
		// Claimed on playing, not before play(): a file this browser cannot
		// play never takes the sound from the music player.
		session?.claim();
		session?.state(true);
		report();
	}

	function onPause(): void {
		playing = false;
		session?.state(false);
		report();
	}

	function onTime(): void {
		if (video === null) return;
		positionMs = Math.round(video.currentTime * 1000);
		report();
	}

	function onVolume(): void {
		if (video === null) return;
		volume = video.volume;
		muted = video.muted;
	}

	function onRate(): void {
		if (video === null) return;
		rate = video.playbackRate;
		session?.position();
	}

	async function onError(): Promise<void> {
		const element = video;
		if (element === null) return;
		const trouble = troubleOf(element.error?.code);
		if (trouble === 'unsupported') {
			phase = 'unsupported';
		} else if (trouble === 'retry' && !retried) {
			retried = true;
			await load(element, file);
		} else if (trouble === 'retry') {
			phase = 'unreadable';
		}
	}
</script>

<div class="tp-player" data-testid="media-player" data-phase={phase}>
	<video
		bind:this={video}
		class:tp-player__gone={phase === 'unsupported' || phase === 'unreadable'}
		playsinline
		preload="metadata"
		onloadedmetadata={onLoadedMetadata}
		onplaying={onPlaying}
		onpause={onPause}
		onended={onPause}
		ontimeupdate={onTime}
		onvolumechange={onVolume}
		onratechange={onRate}
		onseeked={() => session?.position()}
		onerror={() => void onError()}
		data-testid="media-video"
	></video>

	{#if phase === 'unsupported'}
		<div class="tp-player__state" role="alert" data-testid="media-unsupported">
			<p>{m['widget.media.unsupported']()}</p>
			<p class="tp-player__hint">{m['widget.media.unsupported_hint']()}</p>
		</div>
	{:else if phase === 'unreadable'}
		<div class="tp-player__state" role="alert" data-testid="media-unreadable">
			<p>{m['widget.media.unreadable']()}</p>
		</div>
	{:else}
		{#if audioOnly}
			<p class="tp-player__note" role="status" data-testid="media-audio-only">
				{m['widget.media.audio_only']()}
			</p>
		{/if}
		{#if blocked}
			<p class="tp-player__note" role="status">{m['widget.media.press_play']()}</p>
		{/if}
		<TpMediaControls
			{playing}
			{positionMs}
			{durationMs}
			{rate}
			{volume}
			{muted}
			disabled={phase !== 'ready'}
			onToggle={toggle}
			onSeek={(ms) => {
				if (video !== null) video.currentTime = ms / 1000;
			}}
			onRate={(next) => {
				if (video !== null) video.playbackRate = next;
			}}
			onVolume={(next) => {
				if (video === null) return;
				video.volume = next;
				video.muted = next === 0;
			}}
			onMute={() => {
				if (video !== null) video.muted = !video.muted;
			}}
		/>
	{/if}
</div>

<style>
	.tp-player {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	video {
		display: block;
		width: 100%;
		max-height: 60dvh;
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
	}

	.tp-player__gone {
		display: none;
	}

	.tp-player__state {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		color: var(--color-fg);
		padding: 1rem;
	}

	.tp-player__state p,
	.tp-player__note {
		margin: 0;
	}

	.tp-player__hint,
	.tp-player__note {
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}
</style>
