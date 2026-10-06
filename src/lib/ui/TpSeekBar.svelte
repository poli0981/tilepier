<script lang="ts">
	import { fmtDuration } from '$lib/i18n/fmt';
	import { settings } from '$lib/stores/settings.svelte';

	/**
	 * A player's seek bar (doc 09 §2–§3), shared by music and media, which may not
	 * import each other (CLAUDE.md rule 12): the player's numbers come in as
	 * props, and a seek goes out through `onSeek`.
	 *
	 * A native range, so the keyboard, screen readers and touch all work the way
	 * the platform makes them work. While a thumb is held the position does not
	 * move it — otherwise every `timeupdate` would yank it back under the
	 * reader's finger — and the seek happens once, on release. The value is
	 * announced as a time rather than a raw number of milliseconds.
	 */
	interface Props {
		positionMs: number;
		durationMs: number;
		/** The range's accessible name — a message, from the widget. */
		label: string;
		onSeek: (ms: number) => void;
		disabled?: boolean;
		testid?: string | undefined;
	}

	let { positionMs, durationMs, label, onSeek, disabled = false, testid }: Props = $props();

	let dragging = $state<number | null>(null);

	const shown = $derived(dragging ?? positionMs);
	const max = $derived(Math.max(durationMs, 1));

	function input(event: Event): void {
		dragging = Number((event.currentTarget as HTMLInputElement).value);
	}

	function commit(event: Event): void {
		onSeek(Number((event.currentTarget as HTMLInputElement).value));
		dragging = null;
	}
</script>

<div class="tp-seek">
	<span class="tp-num">{fmtDuration(shown, settings.locale)}</span>
	<input
		type="range"
		min="0"
		{max}
		step="1000"
		value={shown}
		{disabled}
		aria-label={label}
		aria-valuetext={fmtDuration(shown, settings.locale)}
		oninput={input}
		onchange={commit}
		data-testid={testid}
	/>
	<span class="tp-num">{fmtDuration(durationMs, settings.locale)}</span>
</div>

<style>
	.tp-seek {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		color: var(--color-fg-mute);
		font-size: var(--text-xs);
	}

	input {
		flex: 1;
		/* The track stays thin; the box is the target (doc 13 §8). */
		height: var(--tp-target);
		margin: 0;
		accent-color: var(--color-beacon);
	}
</style>
