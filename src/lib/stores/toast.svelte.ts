/**
 * The one transient notice the app can raise (doc 13 §7).
 *
 * doc 17 §5 asks for at most one rate-limit toast per 60 s however many widgets
 * trip at once, and the coordinator that decides *whether* has lived in
 * `core/swr.svelte.ts` since Week 3 because that is the only module which sees
 * every 429. This is the half that was missing: somewhere for its answer to go.
 *
 * **No queue.** A queue lets a burst stack four seconds each and turns one bad
 * minute into a marquee. The 60 s throttle upstream already guarantees at most
 * one per minute, so replacing whatever is showing is what "max 1 visible"
 * means here rather than a policy that ever has to drop something.
 *
 * `TpUpdateToast` is separate and stays in the root layout: a service-worker
 * update is not transient and carries no timer, so the two never contend for
 * the slot the way two auto-dismissing toasts would.
 */
/** Not exported: callers reach it through `show()`’s parameter and `current`,
 *  and knip is CI-blocking on an export nothing imports. A second kind will
 *  arrive with doc 13 §7’s “import done” notice. */
type TpToastKind = 'rate-limited';

/**
 * doc 13 §7's four seconds. Long enough to read six words, short enough that a
 * reader who looked away does not come back to a stale claim.
 *
 * Exported so its relationship to `BACKOFF.toastThrottleMs` can be asserted
 * rather than assumed: a toast that outlived its own throttle window would let
 * two be visible at once, which is the one thing doc 13 §7 forbids outright.
 */
export const TOAST_MS = 4_000;

class ToastStore {
	#current = $state<TpToastKind | null>(null);
	#timer: ReturnType<typeof setTimeout> | null = null;

	get current(): TpToastKind | null {
		return this.#current;
	}

	/** Replaces whatever is showing and restarts the clock. */
	show(kind: TpToastKind): void {
		this.#clearTimer();
		this.#current = kind;
		this.#timer = setTimeout(() => {
			this.#current = null;
			this.#timer = null;
		}, TOAST_MS);
	}

	dismiss(): void {
		this.#clearTimer();
		this.#current = null;
	}

	/** Test seam, in the shape `ui`, `online` and `swrCache` already use. */
	reset(): void {
		this.dismiss();
	}

	#clearTimer(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
	}
}

export const toasts = new ToastStore();
