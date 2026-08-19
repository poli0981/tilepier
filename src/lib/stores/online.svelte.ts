/**
 * Connectivity (doc 17 §3).
 *
 * One module decides what "offline" means, because `navigator.onLine` alone is
 * not trustworthy — it reports link state, not reachability, and a captive
 * portal or a dead uplink both read as online. Two consecutive fetch
 * `TypeError`s override it.
 *
 * The scheduler and the top-bar chip both read from here rather than listening
 * to the raw events, so they can never disagree about the current state.
 */

export const OFFLINE_TYPE_ERROR_STREAK = 2;

class OnlineStore {
	#navigatorOnline = $state(true);
	#streak = $state(0);
	#subscribers = new Set<(isOnline: boolean) => void>();
	#detach: (() => void) | null = null;
	#last = true;

	get isOnline(): boolean {
		return this.#navigatorOnline && this.#streak < OFFLINE_TYPE_ERROR_STREAK;
	}

	/** Exposed for the diagnostics panel and for tests; nothing else reads it. */
	get streak(): number {
		return this.#streak;
	}

	/** Idempotent. Returns a detacher for tests; production never detaches. */
	init(): () => void {
		if (this.#detach !== null) return this.#detach;
		if (typeof window === 'undefined') return () => {};

		this.#navigatorOnline = navigator.onLine;
		this.#last = this.isOnline;

		const goOnline = (): void => {
			// The event is evidence the link came back, so the heuristic's
			// suspicion is stale — clearing the streak is the point of it.
			this.#streak = 0;
			this.#navigatorOnline = true;
			this.#emit();
		};
		const goOffline = (): void => {
			this.#navigatorOnline = false;
			this.#emit();
		};

		window.addEventListener('online', goOnline);
		window.addEventListener('offline', goOffline);

		this.#detach = () => {
			window.removeEventListener('online', goOnline);
			window.removeEventListener('offline', goOffline);
			this.#detach = null;
		};
		return this.#detach;
	}

	/** Called by `swr()` on every fetch outcome (doc 17 §3–§4). */
	noteFetchResult(outcome: 'ok' | 'network-error'): void {
		this.#streak = outcome === 'ok' ? 0 : this.#streak + 1;
		this.#emit();
	}

	/** Fires only on a transition, so a subscriber cannot be woken repeatedly
	 *  by a run of failures that never crossed the threshold. */
	subscribe(fn: (isOnline: boolean) => void): () => void {
		this.#subscribers.add(fn);
		return () => {
			this.#subscribers.delete(fn);
		};
	}

	#emit(): void {
		const next = this.isOnline;
		if (next === this.#last) return;
		this.#last = next;
		for (const fn of this.#subscribers) fn(next);
	}

	/** Test seam. */
	reset(): void {
		this.#detach?.();
		this.#subscribers.clear();
		this.#navigatorOnline = true;
		this.#streak = 0;
		this.#last = true;
	}
}

export const online = new OnlineStore();
