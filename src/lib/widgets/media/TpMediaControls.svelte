<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import TpSeekBar from '$lib/ui/TpSeekBar.svelte';
	import { SPEEDS } from './service';
	import TpMediaGlyph from './TpMediaGlyph.svelte';

	/**
	 * The video's own controls (doc 09 §3), drawn in tokens rather than the
	 * browser's: play and pause, the shared seek bar, sound, and speed.
	 *
	 * Props in, callbacks out — the element belongs to `TpMediaPlayer`, which
	 * this never touches. Buttons are 40 px, doc 13 §8's size for a detail.
	 */
	interface Props {
		playing: boolean;
		positionMs: number;
		durationMs: number;
		rate: number;
		volume: number;
		muted: boolean;
		disabled: boolean;
		/** Picture-in-picture, where the browser has it and the video a picture. */
		pipAvailable: boolean;
		inPip: boolean;
		fullscreenAvailable: boolean;
		inFullscreen: boolean;
		onPip: () => void;
		onFullscreen: () => void;
		onToggle: () => void;
		onSeek: (ms: number) => void;
		onRate: (rate: number) => void;
		onVolume: (volume: number) => void;
		onMute: () => void;
	}

	let {
		playing,
		positionMs,
		durationMs,
		rate,
		volume,
		muted,
		disabled,
		pipAvailable,
		inPip,
		fullscreenAvailable,
		inFullscreen,
		onPip,
		onFullscreen,
		onToggle,
		onSeek,
		onRate,
		onVolume,
		onMute
	}: Props = $props();

	const speed = $derived(new Intl.NumberFormat(settings.locale, { maximumFractionDigits: 2 }));
</script>

<div class="tp-mctl" data-testid="media-controls">
	<TpSeekBar
		{positionMs}
		{durationMs}
		{disabled}
		label={m['widget.media.position']()}
		{onSeek}
		testid="media-seek"
	/>
	<div class="tp-mctl__row">
		<button
			type="button"
			class="tp-mctl__play"
			aria-label={playing ? m['widget.media.pause']() : m['widget.media.play']()}
			{disabled}
			onclick={onToggle}
			data-testid="media-toggle"
		>
			<TpIcon name={playing ? 'pause' : 'play'} size={22} />
		</button>

		<button
			type="button"
			aria-label={muted ? m['widget.media.unmute']() : m['widget.media.mute']()}
			aria-pressed={muted}
			onclick={onMute}
			data-testid="media-mute"
		>
			<TpIcon name={muted ? 'mute' : 'volume'} size={18} />
		</button>
		<input
			type="range"
			class="tp-mctl__volume"
			min="0"
			max="1"
			step="0.05"
			value={muted ? 0 : volume}
			aria-label={m['widget.media.volume']()}
			oninput={(event) => onVolume(Number(event.currentTarget.value))}
		/>

		{#if pipAvailable}
			<button
				type="button"
				aria-label={m['widget.media.pip']()}
				aria-pressed={inPip}
				onclick={onPip}
				data-testid="media-pip"
			>
				<TpMediaGlyph name="pip" />
			</button>
		{/if}
		{#if fullscreenAvailable}
			<button
				type="button"
				aria-label={inFullscreen
					? m['widget.media.exit_fullscreen']()
					: m['widget.media.fullscreen']()}
				{disabled}
				onclick={onFullscreen}
				data-testid="media-fullscreen"
			>
				<TpMediaGlyph name={inFullscreen ? 'fullscreen-exit' : 'fullscreen'} />
			</button>
		{/if}

		<label class="tp-mctl__speed">
			<span>{m['widget.media.speed']()}</span>
			<select
				value={rate}
				onchange={(event) => onRate(Number(event.currentTarget.value))}
				data-testid="media-speed"
			>
				{#each SPEEDS as option (option)}
					<option value={option}>
						{m['widget.media.speed_value']({ rate: speed.format(option) })}
					</option>
				{/each}
			</select>
		</label>
	</div>
</div>

<style>
	.tp-mctl {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.tp-mctl__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		cursor: pointer;
	}

	.tp-mctl__play {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}

	button:disabled {
		color: var(--color-fg-dim);
		cursor: default;
	}

	button[aria-pressed='true'] {
		color: var(--color-fg-mute);
	}

	button:focus-visible,
	input:focus-visible,
	select:focus-visible {
		outline: 2px solid var(--color-beacon);
		outline-offset: 1px;
	}

	.tp-mctl__volume {
		width: 7rem;
		accent-color: var(--color-beacon);
	}

	.tp-mctl__speed {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		margin-left: auto;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	select {
		min-height: 36px;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		color: var(--color-fg);
		font: inherit;
		padding: 0 0.5rem;
	}
</style>
