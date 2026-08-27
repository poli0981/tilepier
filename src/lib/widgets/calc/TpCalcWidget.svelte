<script lang="ts">
	import type { TpWidgetProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { formatValue } from './engine';
	import { calc } from './store.svelte';

	/**
	 * doc 07 §3 — the tile: four functions, a result line with locale thousands
	 * separators, and keyboard input while focused.
	 *
	 * The arithmetic is in `decimal.ts` and `engine.ts`, exactly and
	 * deliberately: this file decides what a button says, never what a sum
	 * comes to.
	 *
	 * States (doc 06 §3, pure-client class): `ready`, and `error` inline for a
	 * division by zero or an unfinished expression. `loading` and `empty` are
	 * unreachable — there is nothing to fetch and a calculator showing zero is
	 * showing an answer, not an absence.
	 */
	let { size }: TpWidgetProps = $props();

	/** The keypad, row by row. Symbols only: every glyph here is language-free,
	 *  which is why they are literals and the two word-buttons are not. */
	const KEYS: readonly (readonly string[])[] = [
		['7', '8', '9', '÷'],
		['4', '5', '6', '×'],
		['1', '2', '3', '−'],
		['0', '.', '=', '+']
	];

	const preview = $derived(formatValue(calc.preview, settings.locale));

	const errorText = $derived(
		calc.error === null
			? null
			: calc.error === 'DIVIDE_BY_ZERO'
				? m['widget.calc.error.divide_zero']()
				: calc.error === 'DOMAIN'
					? m['widget.calc.error.domain']()
					: m['widget.calc.error.syntax']()
	);

	function press(key: string): void {
		if (key === '=') calc.submit();
		else calc.append(key);
	}

	/**
	 * doc 07 §3: "keyboard input when focused". Scoped to this element rather
	 * than to the window — the deck's global keys (doc 13 §8) live on the
	 * layout, and a digit typed anywhere else is not meant for the calculator.
	 */
	function onKeydown(event: KeyboardEvent): void {
		if (event.metaKey || event.ctrlKey || event.altKey) return;

		if (/^[0-9.,+\-*/()%]$/.test(event.key)) {
			event.preventDefault();
			calc.append(event.key);
			return;
		}

		if (event.key === 'Enter' || event.key === '=') {
			event.preventDefault();
			calc.submit();
			return;
		}

		if (event.key === 'Backspace') {
			event.preventDefault();
			calc.backspace();
			return;
		}

		if (event.key === 'Delete') {
			event.preventDefault();
			calc.clear();
		}
		// Escape is deliberately not handled: it belongs to whatever layer is
		// above (doc 13 §8), and swallowing it here would trap the user.
	}
</script>

<!--
	The keydown handler sits on the group rather than on a focusable wrapper.
	doc 07 §3 asks for "keyboard input when focused", and focus in practice means
	one of the keys below — every one is a real button, so tabbing into the
	calculator lands inside this element and keystrokes bubble here. Giving the
	group its own `tabindex` would add a stop that reads as interactive to a
	screen reader and is not.

	The rule below fires because a <section> is not itself interactive. That is
	the point: this is a delegation target for keys pressed on the buttons
	inside it, not a control of its own, and every one of those buttons is
	reachable and operable on its own without this handler existing.
-->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<section
	class="tp-calc"
	data-tier={size.tier}
	role="group"
	aria-label={m['widget.calc.title']()}
	onkeydown={onKeydown}
>
	<div class="tp-calc__display">
		<p class="tp-calc__entry tp-num" data-testid="calc-entry">{calc.expression}</p>
		<output class="tp-calc__result tp-num" data-testid="calc-result">{preview}</output>
		{#if errorText !== null}
			<!-- doc 07 §3: divide-by-zero is an inline error, never a blank tile. -->
			<p class="tp-calc__error" role="alert" data-testid="calc-error">{errorText}</p>
		{/if}
	</div>

	<div class="tp-calc__pad">
		<button
			type="button"
			class="tp-calc__key tp-calc__key--ghost"
			aria-label={m['widget.calc.clear']()}
			data-testid="calc-clear"
			onclick={() => calc.clear()}
		>
			<TpIcon name="close" size={14} />
		</button>
		<button
			type="button"
			class="tp-calc__key tp-calc__key--ghost"
			aria-label={m['widget.calc.backspace']()}
			data-testid="calc-backspace"
			onclick={() => calc.backspace()}
		>
			<TpIcon name="edit" size={14} />
		</button>
		<button type="button" class="tp-calc__key" onclick={() => calc.append('(')}>(</button>
		<button type="button" class="tp-calc__key" onclick={() => calc.append(')')}>)</button>

		{#each KEYS as row, rowIndex (rowIndex)}
			{#each row as key (key)}
				<button
					type="button"
					class="tp-calc__key"
					class:accent={key === '='}
					data-testid="calc-key-{key}"
					onclick={() => press(key)}
				>
					{key}
				</button>
			{/each}
		{/each}
	</div>
</section>

<style>
	.tp-calc {
		display: flex;
		height: 100%;
		flex-direction: column;
		gap: 0.375rem;
		overflow: hidden;
	}

	.tp-calc__display {
		flex: 0 0 auto;
		text-align: right;
		overflow: hidden;
	}

	.tp-calc__entry {
		margin: 0;
		height: 1.1em;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-calc__result {
		display: block;
		color: var(--color-fg);
		font-size: var(--text-lg);
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-calc[data-tier='L'] .tp-calc__result {
		font-size: var(--text-xl);
	}

	.tp-calc__error {
		margin: 0;
		color: var(--color-danger);
		font-size: var(--text-2xs);
	}

	.tp-calc__pad {
		display: grid;
		flex: 1 1 auto;
		min-height: 0;
		grid-template-columns: repeat(4, 1fr);
		gap: 3px;
	}

	.tp-calc__key {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: var(--color-ink-950);
		color: var(--color-fg);
		cursor: pointer;
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		min-height: 0;
		padding: 0;
	}

	.tp-calc__key:hover {
		border-color: var(--color-ink-500);
	}

	.tp-calc__key--ghost {
		color: var(--color-fg-dim);
	}

	.tp-calc__key.accent {
		border-color: var(--color-beacon);
		color: var(--color-beacon);
	}
</style>
