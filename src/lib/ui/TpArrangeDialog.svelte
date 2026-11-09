<script lang="ts">
	import type { TpArrangeMove, TpArrangeState } from '#lib/core/grid/arrange.js';
	import { m } from '#lib/paraglide/messages.js';
	import { trapTab } from '#lib/ui/dialog-keys.js';
	import TpIcon from '#lib/ui/icons/TpIcon.svelte';

	/**
	 * Arranging a tile without dragging it (doc 13 §8; WCAG 2.1.1, 2.5.7). The
	 * edit-mode Arrange button opens it for one tile; its buttons, or the arrow
	 * keys, move that tile, and Shift with the arrows resizes it. Every step goes
	 * through TpGrid's `arrange`, so it is stored exactly as a drag is.
	 *
	 * **Docked, with no scrim**: the point is to watch the tile move, so the deck
	 * stays in sight and the tile carries an outline (`markArranging`). It is
	 * still modal for the keyboard: Tab stays inside, as in every panel here.
	 *
	 * **Esc is not handled here.** The layout's `window` listener runs first and
	 * `ui.escape()` closes this layer before edit mode, so a handler of its own
	 * would close the dialog and leave edit mode on one keystroke.
	 *
	 * **A step that cannot happen keeps its button.** `aria-disabled` rather than
	 * `disabled`: a disabled button drops focus to the page the moment the tile
	 * reaches an edge, which is exactly when the reader is pressing it.
	 */
	interface Props {
		/** The tile's name as its own controls say it, numbered when shared. */
		name: string;
		place: TpArrangeState;
		onMove: (move: TpArrangeMove) => void;
		onClose: () => void;
	}

	let { name, place, onMove, onClose }: Props = $props();

	let panelEl = $state<HTMLElement | null>(null);
	/** Said after each step; empty until the first, so opening says the title. */
	let message = $state('');

	const MOVES = [
		{ move: 'left', label: 'common.arrange.left', rotate: 90 },
		{ move: 'up', label: 'common.arrange.up', rotate: 180 },
		{ move: 'down', label: 'common.arrange.down', rotate: 0 },
		{ move: 'right', label: 'common.arrange.right', rotate: -90 }
	] as const;

	const SIZES = [
		{ move: 'narrower', label: 'common.arrange.narrower' },
		{ move: 'wider', label: 'common.arrange.wider' },
		{ move: 'shorter', label: 'common.arrange.shorter' },
		{ move: 'taller', label: 'common.arrange.taller' }
	] as const;

	/** 1-based for people; gridstack counts from 0. */
	const position = $derived(
		m['common.arrange.position']({
			column: place.x + 1,
			columns: place.column,
			row: place.y + 1,
			w: place.w,
			h: place.h
		})
	);

	function step(move: TpArrangeMove): void {
		if (!place.can[move]) {
			message = m['common.arrange.blocked']();
			return;
		}
		onMove(move);
		// `place` is the parent's, read through the prop, so it is already the
		// new place by the time `onMove` returns.
		message = position;
	}

	function keyMove(event: KeyboardEvent): TpArrangeMove | null {
		switch (event.key) {
			case 'ArrowLeft':
				return event.shiftKey ? 'narrower' : 'left';
			case 'ArrowRight':
				return event.shiftKey ? 'wider' : 'right';
			case 'ArrowUp':
				return event.shiftKey ? 'shorter' : 'up';
			case 'ArrowDown':
				return event.shiftKey ? 'taller' : 'down';
			default:
				return null;
		}
	}

	function onKeydown(event: KeyboardEvent): void {
		if (event.key === 'Tab') {
			if (panelEl !== null) trapTab(panelEl, event);
			return;
		}
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const move = keyMove(event);
		if (move === null) return;
		// The arrows would otherwise scroll the page under the tile.
		event.preventDefault();
		step(move);
	}

	$effect(() => {
		// doc 13 §8's focus contract: in on open, back to the Arrange button on
		// close. The button survives every step — gridstack reorders wrappers in
		// the DOM, it never recreates them.
		const trigger = document.activeElement;
		const panel = panelEl;
		panel?.focus();

		// The dock covers the foot of the screen; a tile scrolled into view there
		// would land underneath it.
		const root = document.documentElement;
		if (panel !== null) root.style.scrollPaddingBottom = `${panel.offsetHeight + 16}px`;

		return () => {
			root.style.removeProperty('scroll-padding-bottom');
			if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
		};
	});
</script>

<div
	class="tp-arrange"
	role="dialog"
	aria-modal="true"
	aria-labelledby="tp-arrange-title"
	aria-describedby="tp-arrange-where tp-arrange-hint"
	tabindex="-1"
	bind:this={panelEl}
	onkeydown={onKeydown}
	data-testid="arrange-dialog"
>
	<header>
		<h2 id="tp-arrange-title">{m['common.tile.arrange']({ name })}</h2>
		<button
			type="button"
			class="tp-arrange__close"
			aria-label={m['common.dismiss']()}
			onclick={onClose}
		>
			<TpIcon name="close" size={18} />
		</button>
	</header>

	<p class="tp-arrange__where tp-num" id="tp-arrange-where" data-testid="arrange-where">
		{position}
	</p>
	<p class="tp-arrange__hint" id="tp-arrange-hint">{m['common.arrange.hint']()}</p>

	<div class="tp-arrange__groups">
		<div class="tp-arrange__group" role="group" aria-label={m['common.arrange.move_group']()}>
			{#each MOVES as entry (entry.move)}
				<button
					type="button"
					aria-disabled={!place.can[entry.move]}
					data-testid="arrange-{entry.move}"
					onclick={() => step(entry.move)}
				>
					<span class="tp-arrange__glyph" style="transform: rotate({entry.rotate}deg)">
						<TpIcon name="chevron" size={16} />
					</span>
					{m[entry.label]()}
				</button>
			{/each}
		</div>
		<div class="tp-arrange__group" role="group" aria-label={m['common.arrange.size_group']()}>
			{#each SIZES as entry (entry.move)}
				<button
					type="button"
					aria-disabled={!place.can[entry.move]}
					data-testid="arrange-{entry.move}"
					onclick={() => step(entry.move)}
				>
					{m[entry.label]()}
				</button>
			{/each}
		</div>
	</div>

	<!-- Present from the first paint, empty, so each step's sentence is a change
	     a screen reader announces (the note on the edit-mode region in TpTopBar). -->
	<p class="tp-sr" role="status" data-testid="arrange-status">{message}</p>

	<button type="button" class="tp-arrange__done" data-testid="arrange-done" onclick={onClose}>
		{m['common.done']()}
	</button>
</div>

<style>
	/* Above the drawer (60/61), below the shortcuts sheet (70/71), which can be
	   opened over it with `?`. */
	.tp-arrange {
		position: fixed;
		bottom: 1rem;
		left: 50%;
		z-index: 66;
		transform: translateX(-50%);
		width: min(30rem, calc(100% - 2rem));
		/* As the other panels: scroll inside rather than lose the header at 400 %
		   zoom (WCAG 1.4.10). */
		max-height: calc(100dvh - 2rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-tile);
		background: var(--color-ink-850);
		box-shadow: var(--shadow-tile);
		padding: 0.75rem 1rem 1rem;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	h2 {
		margin: 0;
		font-size: var(--text-base);
		font-weight: 600;
	}

	.tp-arrange__close {
		display: flex;
		align-items: center;
		justify-content: center;
		min-width: var(--tp-target);
		min-height: var(--tp-target);
		border: 0;
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
	}

	.tp-arrange__where {
		margin: 0.25rem 0 0;
		color: var(--color-fg);
		font-size: var(--text-xs);
	}

	.tp-arrange__hint {
		margin: 0.25rem 0 0.75rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-arrange__groups {
		display: grid;
		gap: 0.5rem;
	}

	.tp-arrange__group {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
		gap: 0.375rem;
	}

	.tp-arrange__group button,
	.tp-arrange__done {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		min-height: var(--tp-target);
		border: 1px solid var(--color-field);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-900);
		color: var(--color-fg);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-xs);
		padding: 0 0.5rem;
	}

	.tp-arrange__group button:hover:not([aria-disabled='true']) {
		border-color: var(--color-beacon);
	}

	/* A step with nowhere to go. Disabled controls are exempt from contrast
	   minimums (WCAG 1.4.3), and the word still says what it would do. */
	.tp-arrange__group button[aria-disabled='true'] {
		cursor: default;
		opacity: 0.5;
	}

	.tp-arrange__glyph {
		display: inline-flex;
	}

	.tp-arrange__done {
		margin-top: 0.75rem;
		width: 100%;
		border: 0;
		background: var(--color-beacon);
		color: var(--color-ink-950);
		font-weight: 600;
	}
</style>
