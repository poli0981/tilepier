import type { TpTrack } from '$lib/core/storage/db';

/**
 * The music widget's pure parts (doc 09 §2): the queue, what "next" and
 * "previous" mean, and how a saved playback row is read back. No runes and no
 * Dexie, so all of it tests in the node project against fixed inputs.
 */

export type TpRepeat = 'off' | 'all' | 'one';

/** Where a queue came from — for the "playing from" line, and a rebuild. */
export type TpQueueSource = { kind: 'library' } | { kind: 'playlist'; id: string };

export interface TpQueue {
	source: TpQueueSource;
	/** The tracks in their own order: the library's, or the playlist's. */
	trackIds: readonly string[];
	/** Positions into `trackIds`, in play order — the identity unless shuffled. */
	order: readonly number[];
	/** Where in `order` the current track sits. */
	index: number;
}

export const EMPTY_QUEUE: TpQueue = {
	source: { kind: 'library' },
	trackIds: [],
	order: [],
	index: 0
};

/** "Previous" restarts the track instead, past this far into it (doc 09 §2). */
export const RESTART_AFTER_MS = 3_000;

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * The library's own order — artist, album, track number, title — which is what
 * "play the library" plays. Collated with `numeric`, so "Track 10" follows
 * "Track 9", and base sensitivity, so "Sơn Tùng" and "son tùng" sort together.
 * A track with no artist sorts last rather than first, where an empty string
 * would put it.
 */
export function libraryOrder(tracks: readonly TpTrack[]): TpTrack[] {
	return [...tracks].sort(
		(a, b) =>
			byPresence(a.artist, b.artist) ||
			collator.compare(a.artist, b.artist) ||
			byPresence(a.album, b.album) ||
			collator.compare(a.album, b.album) ||
			(a.trackNo ?? Number.MAX_SAFE_INTEGER) - (b.trackNo ?? Number.MAX_SAFE_INTEGER) ||
			collator.compare(a.title, b.title)
	);
}

function byPresence(a: string, b: string): number {
	return Number(a === '') - Number(b === '');
}

/**
 * Fisher–Yates over the positions *after* the first (doc 09 §2's "over
 * remaining"): the track playing now stays where it is, and everything still
 * to come is dealt fresh. `random` is a parameter so tests can deal a known
 * hand.
 */
export function shuffleRest(
	order: readonly number[],
	random: () => number = Math.random
): number[] {
	const dealt = [...order];
	for (let i = dealt.length - 1; i > 1; i -= 1) {
		const j = 1 + Math.floor(random() * i);
		[dealt[i], dealt[j]] = [dealt[j] as number, dealt[i] as number];
	}
	return dealt;
}

function identity(length: number): number[] {
	return Array.from({ length }, (_, index) => index);
}

/** A queue that starts at `startId`, shuffled after it when `shuffle` is on. */
export function buildQueue(
	trackIds: readonly string[],
	startId: string,
	source: TpQueueSource,
	shuffle: boolean,
	random: () => number = Math.random
): TpQueue {
	const start = Math.max(0, trackIds.indexOf(startId));
	if (!shuffle) return { source, trackIds, order: identity(trackIds.length), index: start };
	const rest = identity(trackIds.length).filter((position) => position !== start);
	return { source, trackIds, order: shuffleRest([start, ...rest], random), index: 0 };
}

/** Turns shuffle on or off mid-queue, keeping the current track current. */
export function reshuffle(
	queue: TpQueue,
	shuffle: boolean,
	random: () => number = Math.random
): TpQueue {
	const at = queue.order[queue.index];
	if (at === undefined) return queue;
	if (!shuffle) return { ...queue, order: identity(queue.trackIds.length), index: at };
	const rest = identity(queue.trackIds.length).filter((position) => position !== at);
	return { ...queue, order: shuffleRest([at, ...rest], random), index: 0 };
}

export function currentId(queue: TpQueue): string | undefined {
	const at = queue.order[queue.index];
	return at === undefined ? undefined : queue.trackIds[at];
}

/** The track after the current one in play order, if there is one to show. */
export function upNextId(queue: TpQueue, repeat: TpRepeat): string | undefined {
	const index = stepIndex(queue, 1, repeat);
	if (index === null) return undefined;
	const at = queue.order[index];
	return at === undefined ? undefined : queue.trackIds[at];
}

/**
 * Where a step of `by` (+1 or −1) lands, or `null` at an end that does not
 * wrap. Repeat-all wraps; repeat-one does not decide anything here — it
 * replays only when a track *ends* on its own, and a press of "next" still
 * means the next track.
 */
export function stepIndex(queue: TpQueue, by: 1 | -1, repeat: TpRepeat): number | null {
	const length = queue.order.length;
	if (length === 0) return null;
	const next = queue.index + by;
	if (next >= 0 && next < length) return next;
	return repeat === 'all' ? (next + length) % length : null;
}

/* ───────────────────────────────────── the saved rows (db `playback`, v2) */

export interface TpSavedPosition {
	trackId: string | null;
	positionMs: number;
	shuffle: boolean;
	repeat: TpRepeat;
	volume: number;
}

const REPEATS: readonly TpRepeat[] = ['off', 'all', 'one'];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

/** The `'music'` row, or `null` for anything this build cannot trust — fail
 *  closed (doc 05 §5): a player that starts empty beats one that starts wrong. */
export function readPosition(state: unknown): TpSavedPosition | null {
	if (!isRecord(state)) return null;
	const { trackId, positionMs, shuffle, repeat, volume } = state;
	if (trackId !== null && typeof trackId !== 'string') return null;
	if (typeof positionMs !== 'number' || !Number.isFinite(positionMs) || positionMs < 0) return null;
	if (typeof shuffle !== 'boolean') return null;
	if (!REPEATS.includes(repeat as TpRepeat)) return null;
	if (typeof volume !== 'number' || !(volume >= 0 && volume <= 1)) return null;
	return { trackId, positionMs, shuffle, repeat: repeat as TpRepeat, volume };
}

/** The `'music:queue'` row, checked the same way. */
export function readQueue(state: unknown): TpQueue | null {
	if (!isRecord(state)) return null;
	const { source, trackIds, order, index } = state;
	const sourceOk =
		isRecord(source) &&
		(source['kind'] === 'library' ||
			(source['kind'] === 'playlist' && typeof source['id'] === 'string'));
	if (!sourceOk) return null;
	if (!Array.isArray(trackIds) || !trackIds.every((id) => typeof id === 'string')) return null;
	if (!Array.isArray(order) || order.length !== trackIds.length) return null;
	const seen = new Set<number>();
	for (const at of order) {
		if (!Number.isInteger(at) || at < 0 || at >= trackIds.length || seen.has(at)) return null;
		seen.add(at);
	}
	if (!Number.isInteger(index) || (index as number) < 0) return null;
	if (trackIds.length > 0 && (index as number) >= trackIds.length) return null;
	return {
		source: source as TpQueueSource,
		trackIds: trackIds as string[],
		order: order as number[],
		index: index as number
	};
}
