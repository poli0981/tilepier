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
 * hidden` and `pagehide` are the last moments a tab reliably gets, and a
 * Dexie write started there **does not finish** on a reload: Dexie commits
 * only once its request has succeeded, a turn an unloading page never gets,
 * so the transaction goes with the document (measured 2026-09-29, doc 04 §6).
 * This comment used to say the transaction "usually does complete". So a
 * caller whose last keystrokes matter hands in `exit`: a synchronous write,
 * committed before the handler returns (`putNow`), which those two moments use
 * instead of `write`. Without it the old flush stands, and is a courtesy.
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
	delayMs: number = DEXIE_DEBOUNCE_MS,
	exit?: (value: T) => void
): TpDexieWriter<T> {
	let pending: T | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;

	function flush(): void {
		const value = take();
		if (value === null) return;
		// Not awaited, and no caller may await it: `flush` is called from a
		// `pagehide` handler, where returning a promise buys nothing and delaying
		// the handler is not allowed.
		void write(value).catch((error: unknown) => onError?.(error));
	}

	/** The page is hiding or going: the committed write, when there is one. */
	function leave(): void {
		if (exit === undefined) {
			flush();
			return;
		}
		const value = take();
		if (value !== null) exit(value);
	}

	function take(): T | null {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		const value = pending;
		pending = null;
		return value;
	}

	function onVisibilityChange(): void {
		if (document.visibilityState === 'hidden') leave();
	}

	const attached = typeof window !== 'undefined';
	if (attached) {
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('pagehide', leave);
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
			window.removeEventListener('pagehide', leave);
		}
	};
}
