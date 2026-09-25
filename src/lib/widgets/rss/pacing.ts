/**
 * Spaces requests out so a deck of feeds cannot rate-limit the whole app.
 *
 * **Why rss needs this and nothing else does.** Every other widget asks for one
 * or two keys per tile. An rss tile asks for up to ten — one GET per feed, by
 * doc 11 §3's design — and the widget is `multiInstance`, so a cold deck with
 * three full tiles is thirty requests the moment it mounts. Both of doc 11 §7's
 * limits are per IP and shared by every tile: the Worker's soft limiter answers
 * 429 past 30 in a 10 s bucket, and the zone rule **blocks all of `/api/*` for
 * 60 s** past 60 in a minute — the weather, the prices and the search box along
 * with the feeds.
 *
 * So feeds wait their turn here: a few at a time, a gap between starts, and a
 * cap on how many starts any window may hold. A 429 pauses the whole queue
 * rather than the one feed that met it, because the limit it met is the one
 * every other queued feed is about to meet too.
 *
 * Per page, not per browser. Two tabs pace separately; the Worker's limiter is
 * what they share, and the budget rss takes (half of each window, in the
 * service) leaves room for that.
 */

interface TpPaceWindow {
	/** Starts allowed in any span of `ms`. */
	limit: number;
	ms: number;
}

export interface TpPacerOptions {
	/** Requests in flight at once. */
	concurrency: number;
	/** The least time between two starts. */
	gapMs: number;
	windows: readonly TpPaceWindow[];
}

export interface TpPacer {
	/**
	 * Waits for a turn and resolves with the function that gives it back.
	 *
	 * Rejects with the signal's reason if the signal aborts first — what `swr`
	 * does when the last tile reading a feed goes away — so a feed nobody reads
	 * any more stops holding a place in the queue.
	 */
	acquire(signal: AbortSignal): Promise<() => void>;
	/** Holds every start until `ms` from now; turns already given run on. */
	pause(ms: number): void;
	/** Test seam: forget every start, pause and waiter. Never called in production. */
	reset(): void;
}

interface Waiter {
	signal: AbortSignal;
	resolve: (release: () => void) => void;
	onAbort: () => void;
}

export function createPacer(options: TpPacerOptions): TpPacer {
	/** Start times, oldest first, as far back as the widest window can see. */
	let starts: number[] = [];
	let waiting: Waiter[] = [];
	let active = 0;
	let pausedUntil = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const memoryMs = Math.max(options.gapMs, ...options.windows.map((window) => window.ms));

	/** The earliest moment one more start fits every rule. */
	function readyAt(now: number): number {
		let at = pausedUntil;

		const last = starts[starts.length - 1];
		if (last !== undefined) at = Math.max(at, last + options.gapMs);

		for (const window of options.windows) {
			const inside = starts.filter((start) => start > now - window.ms);
			if (inside.length < window.limit) continue;
			// One more fits once all but `limit - 1` of these have aged out, which
			// is when the start `limit` places from the newest one leaves.
			const leaving = inside[inside.length - window.limit];
			if (leaving !== undefined) at = Math.max(at, leaving + window.ms);
		}

		return at;
	}

	function pump(): void {
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}

		const now = Date.now();
		starts = starts.filter((start) => start > now - memoryMs);

		while (waiting.length > 0 && active < options.concurrency) {
			const at = readyAt(now);
			if (at > now) {
				timer = setTimeout(pump, at - now);
				return;
			}

			const next = waiting.shift();
			if (next === undefined) return;
			next.signal.removeEventListener('abort', next.onAbort);

			active += 1;
			starts.push(now);

			let returned = false;
			next.resolve(() => {
				// Idempotent: a `finally` that runs twice must not free two turns.
				if (returned) return;
				returned = true;
				active -= 1;
				pump();
			});
		}
	}

	return {
		acquire(signal) {
			if (signal.aborted) return Promise.reject(signal.reason as Error);

			return new Promise((resolve, reject) => {
				const waiter: Waiter = {
					signal,
					resolve,
					onAbort: () => {
						waiting = waiting.filter((other) => other !== waiter);
						reject(signal.reason as Error);
						pump();
					}
				};
				signal.addEventListener('abort', waiter.onAbort, { once: true });
				waiting.push(waiter);
				pump();
			});
		},

		pause(ms) {
			pausedUntil = Math.max(pausedUntil, Date.now() + ms);
			pump();
		},

		reset() {
			if (timer !== null) clearTimeout(timer);
			timer = null;
			for (const waiter of waiting) waiter.signal.removeEventListener('abort', waiter.onAbort);
			starts = [];
			waiting = [];
			active = 0;
			pausedUntil = 0;
		}
	};
}
