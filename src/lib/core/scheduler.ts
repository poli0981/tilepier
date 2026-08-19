import { BACKOFF, SCHEDULER_TICK_MS } from '$lib/shared-constants';
import { online } from '$lib/stores/online.svelte';
import type { TpRefresh } from './registry';

/**
 * The central scheduler (doc 04 §3). Exactly one `setInterval` in the whole
 * app; every recurring job hangs off it, so there is one place that knows what
 * is due, one place that stops on `hidden`, and one place that owns backoff.
 *
 * Widgets never call this directly with a raw interval — `TpWidgetHost`
 * registers whatever a manifest's `refresh` declares and returns `unregister`
 * as its effect teardown. That is what makes doc 19 §6's "no scheduler leaks on
 * remove" true by construction rather than by discipline.
 */

export type TpRunReason = 'register' | 'tick' | 'visible' | 'online' | 'manual';

export type TpTaskState = 'idle' | 'running' | 'backoff' | 'paused' | 'offline';

export interface TpTaskOptions {
	cadence: TpRefresh;
	run: (ctx: { reason: TpRunReason; signal: AbortSignal }) => Promise<void> | void;
	/** Run immediately when the tab becomes visible again, if due. */
	runOnFocus?: boolean;
	/** Run once at registration. */
	runOnRegister?: boolean;
	/** Shown in the diagnostics table (doc 18 §5). */
	label?: string;
}

export interface TpTaskHandle {
	readonly id: string;
	/** Idempotent. Refcounted: the entry goes when the last holder releases. */
	unregister(): void;
	runNow(reason?: TpRunReason): Promise<void>;
	backoff(untilMs: number): void;
	clearBackoff(): void;
}

export interface TpTaskSnapshot {
	id: string;
	label: string;
	cadence: TpRefresh;
	state: TpTaskState;
	lastRunAt: number | null;
	lastOkAt: number | null;
	nextDueAt: number | null;
	consecutiveFailures: number;
	lastError?: string;
	refs: number;
}

interface Entry {
	id: string;
	label: string;
	cadence: TpRefresh;
	run: TpTaskOptions['run'];
	runOnFocus: boolean;
	refs: number;
	running: boolean;
	controller: AbortController | null;
	lastRunAt: number | null;
	lastOkAt: number | null;
	nextDueAt: number | null;
	backoffUntil: number | null;
	consecutiveFailures: number;
	lastError: string | undefined;
}

const entries = new Map<string, Entry>();

let ticker: ReturnType<typeof setInterval> | null = null;
let listenersAttached = false;
let detachOnline: (() => void) | null = null;

/**
 * Start of the next *local* day. `setHours(24, …)` rolls the date over through
 * the Date API, so a DST boundary absorbs itself rather than producing a
 * 23- or 25-hour day of drift.
 */
export function nextMidnight(now: number): number {
	const date = new Date(now);
	date.setHours(24, 0, 0, 0);
	return date.getTime();
}

/** doc 17 §5: exponential 1→2→4→8 s capped at 300 s, with ±20 % jitter. */
function backoffDelay(failures: number): number {
	const raw = Math.min(BACKOFF.baseMs * 2 ** Math.max(0, failures - 1), BACKOFF.maxMs);
	const jitter = raw * BACKOFF.jitterRatio * (Math.random() * 2 - 1);
	return Math.max(0, Math.round(raw + jitter));
}

function computeNextDue(entry: Entry, from: number): number | null {
	switch (entry.cadence.kind) {
		case 'interval':
			return from + entry.cadence.everyMs;
		case 'midnight':
			return nextMidnight(from);
		case 'manual':
			return null;
	}
}

function isHidden(): boolean {
	return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function effectiveDue(entry: Entry): number | null {
	if (entry.nextDueAt === null) return entry.backoffUntil;
	if (entry.backoffUntil === null) return entry.nextDueAt;
	return Math.max(entry.nextDueAt, entry.backoffUntil);
}

function stateOf(entry: Entry, now: number): TpTaskState {
	if (entry.running) return 'running';
	if (!online.isOnline) return 'offline';
	if (entry.backoffUntil !== null && entry.backoffUntil > now) return 'backoff';
	if (isHidden()) return 'paused';
	return 'idle';
}

async function execute(entry: Entry, reason: TpRunReason): Promise<void> {
	// Overlap policy (doc 04 §3): an entry already running is skipped, never
	// queued. A slow job must not be able to build a burst behind itself.
	if (entry.running) return;

	entry.running = true;
	const controller = new AbortController();
	entry.controller = controller;
	// Stamped at the *start*, so the next due time measures from when the work
	// began rather than when it happened to finish.
	const startedAt = Date.now();
	entry.lastRunAt = startedAt;

	try {
		await entry.run({ reason, signal: controller.signal });
		entry.lastOkAt = Date.now();
		entry.consecutiveFailures = 0;
		entry.backoffUntil = null;
		entry.lastError = undefined;
	} catch (error) {
		// swr rejects rather than swallowing precisely so this branch owns the
		// retry curve (doc 04 §2).
		entry.consecutiveFailures += 1;
		entry.lastError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
		entry.backoffUntil = Date.now() + backoffDelay(entry.consecutiveFailures);
	} finally {
		entry.nextDueAt = computeNextDue(entry, startedAt);
		entry.running = false;
		if (entry.controller === controller) entry.controller = null;
	}
}

function tick(now: number = Date.now()): void {
	if (isHidden()) return;

	for (const entry of entries.values()) {
		if (entry.running) continue;
		// doc 06 §7: markets refreshes on a 60 s interval, visible only.
		if (entry.cadence.kind === 'interval' && entry.cadence.visibleOnly === true && isHidden()) {
			continue;
		}
		const due = effectiveDue(entry);
		if (due === null || due > now) continue;
		void execute(entry, 'tick');
	}
}

/** Runs every entry that is due, regardless of the ticker's phase. */
function wake(reason: TpRunReason): void {
	const now = Date.now();
	for (const entry of entries.values()) {
		if (entry.running) continue;
		if (reason === 'visible' && !entry.runOnFocus) continue;
		const due = effectiveDue(entry);
		if (due === null || due > now) continue;
		void execute(entry, reason);
	}
}

function startTicker(): void {
	if (ticker !== null || entries.size === 0 || isHidden()) return;
	ticker = setInterval(() => tick(), SCHEDULER_TICK_MS);
}

function stopTicker(): void {
	if (ticker === null) return;
	clearInterval(ticker);
	ticker = null;
}

function onVisibilityChange(): void {
	if (isHidden()) {
		// Hidden: the ticker stops entirely, for battery (doc 04 §3).
		stopTicker();
		return;
	}
	wake('visible');
	startTicker();
}

function attachListeners(): void {
	if (listenersAttached || typeof document === 'undefined') return;
	listenersAttached = true;
	document.addEventListener('visibilitychange', onVisibilityChange);
	// Subscribed through the store rather than the raw `online` event, so
	// exactly one module decides what "online" means (doc 17 §3).
	detachOnline = online.subscribe((isOnline) => {
		if (isOnline) wake('online');
	});
}

function detachListeners(): void {
	if (!listenersAttached) return;
	listenersAttached = false;
	document.removeEventListener('visibilitychange', onVisibilityChange);
	detachOnline?.();
	detachOnline = null;
}

function makeHandle(id: string): TpTaskHandle {
	let released = false;
	return {
		id,
		unregister() {
			if (released) return;
			released = true;
			const entry = entries.get(id);
			if (entry === undefined) return;
			entry.refs -= 1;
			if (entry.refs > 0) return;
			entry.controller?.abort();
			entries.delete(id);
			if (entries.size === 0) {
				stopTicker();
				detachListeners();
			}
		},
		async runNow(reason: TpRunReason = 'manual') {
			const entry = entries.get(id);
			if (entry === undefined) return;
			// A manual run pre-empts whatever is in flight, rather than being
			// dropped by the overlap rule — the user asked for it.
			entry.controller?.abort();
			entry.running = false;
			await execute(entry, reason);
		},
		backoff(untilMs: number) {
			const entry = entries.get(id);
			if (entry !== undefined) entry.backoffUntil = untilMs;
		},
		clearBackoff() {
			const entry = entries.get(id);
			if (entry === undefined) return;
			entry.backoffUntil = null;
			entry.consecutiveFailures = 0;
		}
	};
}

export const scheduler = {
	/**
	 * `id` is the caller's choice, not necessarily an `instanceId`: two weather
	 * tiles pinned to the same place share one data key and must not fetch
	 * twice (doc 04 §3). Registrations sharing an id are refcounted, and the
	 * **first** registration's options win — a second caller joins the existing
	 * schedule rather than redefining it.
	 */
	register(id: string, options: TpTaskOptions): TpTaskHandle {
		const existing = entries.get(id);
		if (existing !== undefined) {
			existing.refs += 1;
			return makeHandle(id);
		}

		const entry: Entry = {
			id,
			label: options.label ?? id,
			cadence: options.cadence,
			run: options.run,
			runOnFocus: options.runOnFocus ?? true,
			refs: 1,
			running: false,
			controller: null,
			lastRunAt: null,
			lastOkAt: null,
			nextDueAt: null,
			backoffUntil: null,
			consecutiveFailures: 0,
			lastError: undefined
		};
		entry.nextDueAt = computeNextDue(entry, Date.now());
		entries.set(id, entry);

		attachListeners();
		startTicker();

		if ((options.runOnRegister ?? true) && options.cadence.kind !== 'manual') {
			void execute(entry, 'register');
		}

		return makeHandle(id);
	},

	/** The doc 18 §5 diagnostics table. A snapshot, never the live entries. */
	inspect(): readonly TpTaskSnapshot[] {
		const now = Date.now();
		return [...entries.values()].map((entry) => {
			const base: TpTaskSnapshot = {
				id: entry.id,
				label: entry.label,
				cadence: entry.cadence,
				state: stateOf(entry, now),
				lastRunAt: entry.lastRunAt,
				lastOkAt: entry.lastOkAt,
				nextDueAt: effectiveDue(entry),
				consecutiveFailures: entry.consecutiveFailures,
				refs: entry.refs
			};
			return entry.lastError === undefined ? base : { ...base, lastError: entry.lastError };
		});
	},

	/** How many entries are live. `e2e/s1-grid` asserts this returns to
	 *  baseline after add/remove cycles (doc 06 §5). */
	get size(): number {
		return entries.size;
	},

	/** Test seam: drive the clock directly instead of stubbing setInterval. */
	tick,

	/** Test seam: drop every entry and detach. Never called in production. */
	reset(): void {
		for (const entry of entries.values()) entry.controller?.abort();
		entries.clear();
		stopTicker();
		detachListeners();
	}
};
