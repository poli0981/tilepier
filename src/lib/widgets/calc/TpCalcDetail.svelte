<script lang="ts">
	import type { TpDetailProps } from '$lib/core/types';
	import { m } from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import TpIcon from '$lib/ui/icons/TpIcon.svelte';
	import { CATEGORIES, convert, unitsFor, type TpUnitCategory } from './convert';
	import { fromString, type TpDecimal } from './decimal';
	import { formatValue, type TpCalcUnary } from './engine';
	import { calc } from './store.svelte';

	/**
	 * doc 07 §3 — the detail: the session tape, the scientific row, and the
	 * converter.
	 *
	 * It shares one store with the tile (`store.svelte.ts`), because `calc` is
	 * single-instance and this is a bigger view of the same calculator rather
	 * than a second one. Typing in the tile and opening this panel shows the
	 * same expression, which is the only behaviour that would not surprise
	 * anyone.
	 */

	// Declared, not read. The calculator keeps no per-instance settings — its
	// state is the module-level store — but a component that destructures
	// nothing has a props type of `Record<string, never>`, which is not
	// assignable to the manifest's `Component<TpDetailProps>`. The underscore is
	// the pattern eslint's unused-vars rule allows.
	const _props: TpDetailProps = $props();

	/** Label and operation together, so the row is one list rather than two
	 *  parallel ones that can drift out of order. */
	const SCIENTIFIC: readonly { operation: TpCalcUnary; label: () => string }[] = [
		{ operation: 'percent', label: () => m['widget.calc.sci.percent']() },
		{ operation: 'sqrt', label: () => m['widget.calc.sci.sqrt']() },
		{ operation: 'square', label: () => m['widget.calc.sci.square']() },
		{ operation: 'reciprocal', label: () => m['widget.calc.sci.reciprocal']() },
		{ operation: 'negate', label: () => m['widget.calc.sci.negate']() }
	];

	let category = $state<TpUnitCategory>('length');
	let amount = $state('1');
	let fromUnit = $state('m');
	let toUnit = $state('ft');
	let copied = $state<string | null>(null);

	const units = $derived(unitsFor(category));

	function pickCategory(next: TpUnitCategory): void {
		category = next;
		// The old units belong to the old category; carrying them over would ask
		// the converter to turn metres into kilograms.
		const list = unitsFor(next);
		fromUnit = list[0] ?? '';
		toUnit = list[1] ?? list[0] ?? '';
	}

	const converted = $derived.by(() => {
		const parsed = fromString(amount.replace(',', '.'));
		if (parsed === null) return null;

		const outcome = convert(parsed, fromUnit, toUnit, category);
		return outcome.ok ? outcome.value : null;
	});

	function swap(): void {
		[fromUnit, toUnit] = [toUnit, fromUnit];
	}

	async function copy(value: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(value);
			copied = value;
			// doc 13 §7: copy confirmations are micro-feedback, not a toast.
			setTimeout(() => (copied = copied === value ? null : copied), 1500);
		} catch {
			// A denied clipboard is not worth an error state for; the number is
			// on screen and can be selected.
		}
	}

	function categoryLabel(value: TpUnitCategory): string {
		return m[`widget.calc.category.${value}`]();
	}

	function show(value: TpDecimal): string {
		return formatValue(value, settings.locale);
	}

	/** A tape row holds the exact decimal string; the reader wants it grouped
	 *  and localised like every other number on screen (doc 07 §3). */
	function showText(text: string): string {
		const parsed = fromString(text);
		return parsed === null ? text : show(parsed);
	}
</script>

<div class="tp-calcd">
	<section>
		<h3>{m['widget.calc.scientific']()}</h3>
		<div class="tp-calcd__sci">
			{#each SCIENTIFIC as entry (entry.operation)}
				<button
					type="button"
					data-testid="calc-sci-{entry.operation}"
					onclick={() => calc.applyToValue(entry.operation)}
				>
					{entry.label()}
				</button>
			{/each}
		</div>
	</section>

	<section>
		<div class="tp-calcd__head">
			<h3>{m['widget.calc.tape']()}</h3>
			{#if calc.tape.length > 0}
				<button type="button" class="tp-calcd__ghost" onclick={() => calc.clearTape()}>
					{m['widget.calc.tape_clear']()}
				</button>
			{/if}
		</div>

		{#if calc.tape.length === 0}
			<!-- doc 06 §3's `empty`, and the one place this widget has one: a tape
			     with nothing on it yet is genuinely empty. -->
			<p class="tp-calcd__note" data-testid="calc-tape-empty">{m['widget.calc.tape_empty']()}</p>
		{:else}
			<ul class="tp-calcd__tape" data-testid="calc-tape">
				{#each calc.tape as row, index (index)}
					<li>
						<button
							type="button"
							class="tp-calcd__row"
							aria-label={m['widget.calc.tape_recall']({ result: row.result })}
							onclick={() => calc.recall(row.result)}
						>
							<span class="tp-calcd__expr tp-num">{row.expression}</span>
							<span class="tp-calcd__value tp-num">{showText(row.result)}</span>
						</button>
						<button
							type="button"
							class="tp-calcd__copy"
							aria-label={m['widget.calc.copy']({ result: row.result })}
							onclick={() => void copy(row.result)}
						>
							{#if copied === row.result}
								<TpIcon name="check" size={14} />
							{:else}
								<TpIcon name="note" size={14} />
							{/if}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section>
		<h3>{m['widget.calc.converter']()}</h3>

		<div class="tp-calcd__cats" role="group" aria-label={m['widget.calc.converter']()}>
			{#each CATEGORIES as entry (entry)}
				<button
					type="button"
					aria-pressed={category === entry}
					data-testid="calc-cat-{entry}"
					onclick={() => pickCategory(entry)}
				>
					{categoryLabel(entry)}
				</button>
			{/each}
		</div>

		<div class="tp-calcd__convert">
			<label>
				<span>{m['widget.calc.from']()}</span>
				<input
					class="tp-num"
					inputmode="decimal"
					bind:value={amount}
					data-testid="calc-amount"
					aria-label={m['widget.calc.from']()}
				/>
				<select bind:value={fromUnit} data-testid="calc-from">
					{#each units as unit (unit)}
						<option value={unit}>{unit}</option>
					{/each}
				</select>
			</label>

			<button
				type="button"
				class="tp-calcd__ghost"
				data-testid="calc-swap"
				aria-label={m['widget.calc.to']()}
				onclick={swap}
			>
				<TpIcon name="expand" size={14} />
			</button>

			<label>
				<span>{m['widget.calc.to']()}</span>
				<output class="tp-num" data-testid="calc-converted">
					{converted === null ? '—' : show(converted)}
				</output>
				<select bind:value={toUnit} data-testid="calc-to">
					{#each units as unit (unit)}
						<option value={unit}>{unit}</option>
					{/each}
				</select>
			</label>
		</div>
	</section>
</div>

<style>
	.tp-calcd {
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	h3 {
		margin: 0 0 0.5rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
		font-weight: 500;
	}

	.tp-calcd__head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
	}

	.tp-calcd__sci,
	.tp-calcd__cats {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.tp-calcd__sci button,
	.tp-calcd__cats button,
	.tp-calcd__ghost {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg-mute);
		cursor: pointer;
		font: inherit;
		font-size: var(--text-2xs);
		min-height: 40px;
		padding: 0 0.75rem;
	}

	.tp-calcd__sci button {
		font-family: var(--font-mono);
		min-width: 48px;
	}

	.tp-calcd__cats button[aria-pressed='true'] {
		background: var(--color-beacon-soft);
		color: var(--color-beacon);
	}

	.tp-calcd__ghost {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 36px;
	}

	.tp-calcd__tape {
		display: flex;
		max-height: 16rem;
		flex-direction: column;
		overflow: auto;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.tp-calcd__tape li {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		border-bottom: 1px solid var(--color-ink-700);
	}

	.tp-calcd__row {
		display: flex;
		flex: 1 1 auto;
		min-width: 0;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		border: 0;
		background: none;
		cursor: pointer;
		font: inherit;
		min-height: 40px;
		padding: 0;
		text-align: left;
	}

	.tp-calcd__expr {
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-calcd__value {
		color: var(--color-fg);
		font-size: var(--text-xs);
	}

	.tp-calcd__copy {
		display: flex;
		align-items: center;
		justify-content: center;
		border: 0;
		background: none;
		color: var(--color-fg-dim);
		cursor: pointer;
		min-width: 40px;
		min-height: 40px;
	}

	.tp-calcd__copy:hover {
		color: var(--color-beacon);
	}

	.tp-calcd__note {
		margin: 0;
		color: var(--color-fg-dim);
		font-size: var(--text-2xs);
	}

	.tp-calcd__convert {
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.tp-calcd__convert label {
		display: flex;
		flex: 1 1 12rem;
		flex-direction: column;
		gap: 0.25rem;
		color: var(--color-fg-mute);
		font-size: var(--text-2xs);
	}

	.tp-calcd__convert input,
	.tp-calcd__convert output,
	.tp-calcd__convert select {
		border: 1px solid var(--color-ink-700);
		border-radius: var(--radius-ctl);
		background: none;
		color: var(--color-fg);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		min-height: 40px;
		padding: 0 0.5rem;
	}

	.tp-calcd__convert output {
		display: flex;
		align-items: center;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tp-calcd__convert select {
		font-family: inherit;
		margin-top: 0.25rem;
	}
</style>
