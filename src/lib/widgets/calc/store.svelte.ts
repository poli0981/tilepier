import { toPlainString, type TpDecimal } from './decimal';
import { applyUnary, evaluate, type TpCalcError, type TpCalcUnary } from './engine';

/**
 * The calculator's working state, shared by the tile and its detail.
 *
 * **Session-only, and module-level.** doc 07 §3 calls the tape "session-only",
 * and a half-typed expression has no business in `tp.layout.v1` — it is not a
 * preference, it does not deserve to survive a reload, and it would ride along
 * in every backup. Module-level rather than per-component because `calc` is
 * `multiInstance: false` (doc 06 §7): there is exactly one calculator, and the
 * detail is a bigger view of the same one, not a second.
 *
 * A `.svelte.ts` module because it holds `$state` — Svelte 5 requires the
 * infix outside components.
 */

interface TpTapeRow {
	expression: string;
	/** The exact decimal string. Locale formatting happens at render. */
	result: string;
}

/** Enough to scroll through, not enough to grow without bound in a tab left
 *  open for a week. */
const TAPE_LIMIT = 50;

class CalcStore {
	#expression = $state('');
	#tape = $state<TpTapeRow[]>([]);
	#error = $state<TpCalcError | null>(null);
	/** The last committed result, which is what the scientific row acts on. */
	#value = $state<TpDecimal>({ v: 0n, s: 0 });

	get expression(): string {
		return this.#expression;
	}

	get tape(): readonly TpTapeRow[] {
		return this.#tape;
	}

	get error(): TpCalcError | null {
		return this.#error;
	}

	get value(): TpDecimal {
		return this.#value;
	}

	/**
	 * The number shown while typing: the live evaluation of what is on the
	 * entry line, or the last committed value when the line is empty. A
	 * half-typed expression is not an error — `2 +` is a person mid-thought —
	 * so a failure here leaves the previous preview standing rather than
	 * flashing a complaint on every keystroke.
	 */
	get preview(): TpDecimal {
		if (this.#expression.trim() === '') return this.#value;
		const outcome = evaluate(this.#expression);
		return outcome.ok ? outcome.value : this.#value;
	}

	append(text: string): void {
		this.#error = null;
		this.#expression += text;
	}

	backspace(): void {
		this.#error = null;
		this.#expression = this.#expression.slice(0, -1);
	}

	clear(): void {
		this.#error = null;
		this.#expression = '';
		this.#value = { v: 0n, s: 0 };
	}

	/** `=`. Commits the line to the tape, or reports why it could not. */
	submit(): void {
		if (this.#expression.trim() === '') return;

		const outcome = evaluate(this.#expression);
		if (!outcome.ok) {
			this.#error = outcome.error;
			return;
		}

		this.#error = null;
		this.#value = outcome.value;
		this.#tape = [
			{ expression: this.#expression, result: toPlainString(outcome.value) },
			...this.#tape
		].slice(0, TAPE_LIMIT);
		this.#expression = '';
	}

	/** The scientific row (doc 07 §3), which acts on the committed value rather
	 *  than on the text of the expression. */
	applyToValue(operation: TpCalcUnary): void {
		const source = this.preview;
		const outcome = applyUnary(source, operation);

		if (!outcome.ok) {
			this.#error = outcome.error;
			return;
		}

		this.#error = null;
		this.#value = outcome.value;
		this.#expression = '';
		this.#tape = [
			{
				expression: `${operation}(${toPlainString(source)})`,
				result: toPlainString(outcome.value)
			},
			...this.#tape
		].slice(0, TAPE_LIMIT);
	}

	/** Puts a tape row's result back on the entry line, which is what tapping a
	 *  row is for. */
	recall(result: string): void {
		this.#error = null;
		this.#expression = result;
	}

	clearTape(): void {
		this.#tape = [];
	}

	/** Test seam, and what a fresh mount would see. */
	reset(): void {
		this.clear();
		this.clearTape();
	}
}

export const calc = new CalcStore();
