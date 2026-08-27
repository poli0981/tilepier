/**
 * Debounced writes to Dexie (doc 04 §6: "Notes/todos/events/playlists write
 * straight to Dexie with a 300 ms debounce for keystroke-level edits, and an
 * immediate flush on `visibilitychange → hidden` and `pagehide`").
 *
 * The same shape as `createDebouncedWriter` in `local.ts`, on purpose: two
 * kinds of debounce in one codebase is one too many, and a caller moving
 * between them should not have to learn a second API. What differs is what it
 * is debouncing — a whole versioned document there, one record here — and that
 * the write is asynchronous, which brings its own problem.
 *
 * **The flush must not be lost to the page going away.** `visibilitychange →
 * hidden` and `pagehide` are the last moments a tab reliably gets, and an
 * IndexedDB write started there is not guaranteed to finish. That is not a
 * reason to skip it: the transaction usually does complete, and the
 * alternative is losing the last 300 ms of typing every single time someone
 * switches tabs mid-sentence. It *is* a reason not to await anything after it.
 */

export interface TpDexieWriter<T> {
	/** Replaces whatever was pending. The last value within the window wins. */
	schedule(value: T): void;
	/** Writes immediately, if anything is pending. Fire-and-forget by design. */
	flush(): void;
	dispose(): void;
}

/** doc 04 §6. Not exported: it is this module's default and nothing else
 *  should be reaching for it — knip is CI-blocking on an export with no
 *  consumer (doc 20 §5). */
const DEXIE_DEBOUNCE_MS = 300;

export function createDexieWriter<T>(
	write: (value: T) => Promise<unknown>,
	onError?: (error: unknown) => void,
	delayMs: number = DEXIE_DEBOUNCE_MS
): TpDexieWriter<T> {
	let pending: T | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function flush(): void {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		if (pending === null) return;

		const value = pending;
		pending = null;
		// Not awaited, and no caller may await it: `flush` is called from a
		// `pagehide` handler, where returning a promise buys nothing and delaying
		// the handler is not allowed.
		void write(value).catch((error: unknown) => onError?.(error));
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden') flush();
	}

	const attached = typeof window !== 'undefined';
	if (attached) {
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', flush);
	}

	return {
		schedule(value: T) {
			pending = value;
			if (timer !== null) clearTimeout(timer);
			timer = setTimeout(flush, delayMs);
		},
		flush,
		dispose() {
			flush();
			if (!attached) return;
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('pagehide', flush);
		}
	};
}
