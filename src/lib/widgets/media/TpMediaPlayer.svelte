<script lang="ts">
	import { untrack } from 'svelte';
	import { m } from '$lib/paraglide/messages';
	import { TpVideoController } from './controller.svelte';
	import type { TpMediaFile } from './store.svelte';
	import TpMediaControls from './TpMediaControls.svelte';

	/**
	 * The video itself (doc 09 §3): one `<video>`, drawn here and driven by a
	 * `TpVideoController`, which holds its state and answers its events. This
	 * component only puts the element on the page and says what state it is in.
	 */
	interface Props {
		file: TpMediaFile;
	}

	let { file }: Props = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let box = $state<HTMLElement | null>(null);
	let player = $state<TpVideoController | null>(null);

	$effect(() => {
		const element = video;
		const region = box;
		const source = file;
		if (element === null || region === null) return;
		// Built untracked: the controller writes its own state as it starts, and
		// none of that may become a reason to build it again.
		const current = untrack(() => new TpVideoController(element, region, source));
		player = current;
		return () => {
			current.dispose();
			if (player === current) player = null;
		};
	});

	const phase = $derived(player?.phase ?? 'loading');
</script>

<div class="tp-player" bind:this={box} data-testid="media-player" data-phase={phase}>
	<video
		bind:this={video}
		tabindex="0"
		aria-label={m['widget.media.region']({ name: file.name })}
		class:tp-player__gone={phase === 'unsupported' || phase === 'unreadable'}
		playsinline
		preload="metadata"
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
	{:else if player !== null}
		{#if player.audioOnly}
			<p class="tp-player__note" role="status" data-testid="media-audio-only">
				{m['widget.media.audio_only']()}
			</p>
		{/if}
		{#if player.blocked}
			<p class="tp-player__note" role="status">{m['widget.media.press_play']()}</p>
		{/if}
		<TpMediaControls
			playing={player.playing}
			positionMs={player.positionMs}
			durationMs={player.durationMs}
			rate={player.rate}
			volume={player.volume}
			muted={player.muted}
			disabled={phase !== 'ready'}
			pipAvailable={player.pipAvailable}
			inPip={player.inPip}
			fullscreenAvailable={player.fullscreenAvailable}
			inFullscreen={player.inFullscreen}
			onPip={() => player?.togglePip()}
			onFullscreen={() => player?.toggleFullscreen()}
			onToggle={() => player?.toggle()}
			onSeek={(ms) => player?.seekTo(ms)}
			onRate={(next) => player?.setRate(next)}
			onVolume={(next) => player?.setVolume(next)}
			onMute={() => player?.toggleMute()}
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
		outline: none;
		width: 100%;
		max-height: 60dvh;
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
	}

	video:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 2px;
	}

	/* Full screen: the box fills it, the video takes what the controls leave. */
	.tp-player:fullscreen {
		justify-content: center;
		background: var(--color-ink-950);
		padding: 1rem;
	}

	.tp-player:fullscreen video {
		max-height: none;
		flex: 1;
		min-height: 0;
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
