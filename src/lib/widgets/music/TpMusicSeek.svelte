<script lang="ts">
	import { fmtDuration } from '$lib/i18n/fmt';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import { player } from './player.svelte';

	/**
	 * The detail's seek bar (doc 09 §2): a native range, so the keyboard, screen
	 * readers and touch all work the way the platform makes them work.
	 *
	 * While a thumb is held the player's position does not move it — otherwise
	 * every `timeupdate` would yank it back under the reader's finger — and the
	 * seek happens once, on release. The value is announced as a time rather
	 * than a raw number of milliseconds.
	 */
	let dragging = $state<number | null>(null);

	const shown = $derived(dragging ?? player.positionMs);
	const max = $derived(Math.max(player.durationMs, 1));

	function input(event: Event): void {
		dragging = Number((event.currentTarget as HTMLInputElement).value);
	}

	function commit(event: Event): void {
		player.seek(Number((event.currentTarget as HTMLInputElement).value));
		dragging = null;
	}
</script>

<div class="tp-mseek">
	<span class="tp-num">{fmtDuration(shown, settings.locale)}</span>
	<input
		type="range"
		min="0"
		{max}
		step="1000"
		value={shown}
		disabled={player.current === null || player.durationMs === 0}
		aria-label={m['widget.music.position']()}
		aria-valuetext={fmtDuration(shown, settings.locale)}
		oninput={input}
		onchange={commit}
		data-testid="music-seek"
	/>
	<span class="tp-num">{fmtDuration(player.durationMs, settings.locale)}</span>
</div>

<style>
	.tp-mseek {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	input {
		flex: 1;
		accent-color: var(--color-beacon);
	}
</style>
