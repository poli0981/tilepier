/**
 * Console ring buffer (doc 18 §1).
 *
 * TilePier never phones home (doc 18 §6), so the only way a user can hand over
 * console context is to carry it themselves. This keeps the last N lines in
 * memory, mirrors them to sessionStorage so a crash-reload does not lose the
 * tail, and scrubs anything that looks like a credential on the way in.
 *
 * Deliberately rune-free: `hooks.client.ts` and node tests both import it, and
 * neither is a component.
 */

export type TpLogLevel = 'info' | 'warn' | 'error';

/**
 * Where an entry came from (doc 18 §1's `src`). One value per *subsystem*, not
 * per widget: fifteen widget ids in this union would make it a registry, and
 * the ring buffer is fifty entries deep — which widget it was belongs in the
 * message, where a reader can see it, not in a type nobody reads.
 */
export type TpLogSource =
	| 'boot'
	| 'console'
	| 'onerror'
	| 'unhandledrejection'
	| 'boundary'
	| 'layout'
	/** A widget reporting on its own data — a stored value it had to discard. */
	| 'widget'
	/** The detail overlay and its chunk loading (doc 06 §6). */
	| 'detail';

export interface TpLogEntry {
	ts: number;
	level: TpLogLevel;
	/** Scrubbed and truncated at write time. */
	msg: string;
	/** At most three frames, newline-joined. */
	stackTop?: string;
	src: TpLogSource;
}

export const LOG_CAPACITY = 50;
export const MIRROR_THROTTLE_MS = 2_000;
export const SESSION_KEY = 'tp.logs';
export const MAX_MSG_CHARS = 500;
const MAX_STACK_FRAMES = 3;
const NOTIFY_COALESCE_MS = 250;

/**
 * Scrubbed on the way in, not only on the way out: the buffer is also rendered
 * live in the diagnostics panel (doc 18 §5), so a secret that only got cleaned
 * at export time would still have been on screen.
 *
 * The `(?:bearer|basic|token)\s+` group is load-bearing: without it,
 * `authorization: Bearer <jwt>` redacts the word "Bearer" and leaves the token
 * in plain sight, which is the single most common way a credential reaches a
 * console. Widening the tail to two tokens instead would be worse — it eats the
 * *next* key's name and lets that value through.
 *
 * The quoted alternatives cover `"key": "value with spaces"` from JSON dumps.
 */
const SECRET_PATTERN =
	/\b(token|api[_-]?key|key|secret|authorization|password)\b["']?\s*[:=]\s*(?:(?:bearer|basic|token)\s+)?("[^"]*"|'[^']*'|\S+)/gi;
const URL_QUERY_PATTERN = /(https?:\/\/[^\s"']+)\?\S*/g;

const buffer: TpLogEntry[] = [];
const subscribers = new Set<(entries: readonly TpLogEntry[]) => void>();

let installed = false;
let teardown: (() => void)[] = [];
/** Guards against a throw inside serialisation re-entering the wrapper. */
let writing = false;
let mirrorTimer: ReturnType<typeof setTimeout> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function scrub(text: string): string {
	return text.replace(SECRET_PATTERN, '$1=<redacted>').replace(URL_QUERY_PATTERN, '$1?<redacted>');
}

/** Depth-1 with a cycle guard: enough to identify a value, cheap enough to run
 *  on every console.warn without thinking about it. */
function describe(value: unknown, seen: WeakSet<object>): string {
	if (typeof value === 'string') return value;
	if (value === null) return 'null';
	if (value === undefined) return 'undefined';
	if (typeof value === 'bigint') return `${value}n`;
	if (typeof value !== 'object' && typeof value !== 'function') return String(value);

	if (typeof value === 'function') return `[fn ${value.name || 'anonymous'}]`;
	if (value instanceof Error) return `${value.name}: ${value.message}`;
	if (typeof Node !== 'undefined' && value instanceof Node) {
		return value instanceof Element ? `<${value.tagName.toLowerCase()}>` : `[${value.nodeName}]`;
	}

	if (seen.has(value)) return '[circular]';
	seen.add(value);

	if (Array.isArray(value)) {
		return `[${value.map((item) => describeShallow(item, seen)).join(', ')}]`;
	}
	const entries = Object.entries(value as Record<string, unknown>).map(
		([key, item]) => `${key}: ${describeShallow(item, seen)}`
	);
	return `{${entries.join(', ')}}`;
}

/** One level down from `describe`, so nesting stops rather than recursing. */
function describeShallow(value: unknown, seen: WeakSet<object>): string {
	if (value !== null && typeof value === 'object' && !(value instanceof Error)) {
		if (seen.has(value)) return '[circular]';
		return Array.isArray(value) ? `[…${value.length}]` : '{…}';
	}
	return describe(value, seen);
}

function toMessage(parts: readonly unknown[]): string {
	const seen = new WeakSet<object>();
	const joined = parts.map((part) => describe(part, seen)).join(' ');
	const scrubbed = scrub(joined);
	return scrubbed.length > MAX_MSG_CHARS ? `${scrubbed.slice(0, MAX_MSG_CHARS - 1)}…` : scrubbed;
}

function stackTopOf(value: unknown): string | undefined {
	const stack = value instanceof Error ? value.stack : undefined;
	if (typeof stack !== 'string') return undefined;
	const frames = stack
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.startsWith('at '))
		.slice(0, MAX_STACK_FRAMES);
	return frames.length > 0 ? scrub(frames.join('\n')) : undefined;
}

function sessionStore(): Storage | null {
	try {
		return typeof sessionStorage === 'undefined' ? null : sessionStorage;
	} catch {
		return null;
	}
}

function mirrorNow(): void {
	if (mirrorTimer !== null) {
		clearTimeout(mirrorTimer);
		mirrorTimer = null;
	}
	const store = sessionStore();
	if (store === null) return;
	try {
		store.setItem(SESSION_KEY, JSON.stringify(buffer));
	} catch {
		// A full session quota is not worth failing a log write over.
	}
}

function scheduleMirror(): void {
	if (mirrorTimer !== null) return;
	mirrorTimer = setTimeout(mirrorNow, MIRROR_THROTTLE_MS);
}

function notify(): void {
	if (subscribers.size === 0 || notifyTimer !== null) return;
	notifyTimer = setTimeout(() => {
		notifyTimer = null;
		const snapshot = readLog();
		for (const fn of subscribers) fn(snapshot);
	}, NOTIFY_COALESCE_MS);
}

function push(entry: TpLogEntry): void {
	buffer.push(entry);
	while (buffer.length > LOG_CAPACITY) buffer.shift();
	scheduleMirror();
	notify();
}

/** Structured push, for code that already knows what it is saying. */
export function logEntry(
	level: TpLogLevel,
	msg: unknown,
	options: { src?: TpLogSource; error?: unknown } = {}
): void {
	const src = options.src ?? 'console';
	const stackTop = stackTopOf(options.error ?? msg);
	const base: TpLogEntry = {
		ts: Date.now(),
		level,
		msg: toMessage(options.error === undefined ? [msg] : [msg, options.error]),
		src
	};
	// exactOptionalPropertyTypes: omit rather than assign undefined.
	push(stackTop === undefined ? base : { ...base, stackTop });
}

/** Newest last. A copy, never the live array. */
export function readLog(): readonly TpLogEntry[] {
	return buffer.slice();
}

export function clearLog(): void {
	buffer.length = 0;
	mirrorNow();
	notify();
}

/** Live updates for the diagnostics panel (doc 18 §5), coalesced. */
export function subscribeLog(fn: (entries: readonly TpLogEntry[]) => void): () => void {
	subscribers.add(fn);
	return () => {
		subscribers.delete(fn);
	};
}

/** The block the bug dialog copies and the .txt download contains (doc 18 §4). */
export function formatLog(entries: readonly TpLogEntry[] = readLog()): string {
	return entries
		.map((entry) => {
			const time = new Date(entry.ts).toISOString().slice(11, 23);
			const head = `${time} ${entry.level.toUpperCase().padEnd(5)} [${entry.src}] ${entry.msg}`;
			// Scrubbed a second time: defence in depth, per doc 18 §1.
			return scrub(entry.stackTop === undefined ? head : `${head}\n${entry.stackTop}`);
		})
		.join('\n');
}

function restoreTail(): void {
	const store = sessionStore();
	if (store === null) return;
	let raw: string | null;
	try {
		raw = store.getItem(SESSION_KEY);
	} catch {
		return;
	}
	if (raw === null) return;
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return;
		for (const item of parsed.slice(-LOG_CAPACITY)) {
			if (
				typeof item === 'object' &&
				item !== null &&
				typeof (item as TpLogEntry).msg === 'string'
			) {
				buffer.push(item as TpLogEntry);
			}
		}
	} catch {
		// A corrupt mirror is not worth a failed boot.
	}
}

/**
 * Idempotent. Returns an uninstaller, which exists for tests — production
 * installs once from `hooks.client.ts` and never removes it.
 */
export function installLogBuffer(meta: {
	version: string;
	sha: string;
	uaBrand: string;
	locale: string;
}): () => void {
	if (installed) return () => {};
	installed = true;

	restoreTail();

	const nativeWarn = console.warn.bind(console);
	const nativeError = console.error.bind(console);

	function wrap(level: 'warn' | 'error', native: (...args: unknown[]) => void) {
		return (...args: unknown[]): void => {
			// Call through first (doc 18 §1) so a throw in our own serialisation
			// cannot swallow the developer's message.
			native(...args);
			if (writing) return;
			writing = true;
			try {
				const stackTop = args.map(stackTopOf).find((s) => s !== undefined);
				const base: TpLogEntry = {
					ts: Date.now(),
					level,
					msg: toMessage(args),
					src: 'console'
				};
				push(stackTop === undefined ? base : { ...base, stackTop });
			} finally {
				writing = false;
			}
		};
	}

	console.warn = wrap('warn', nativeWarn);
	console.error = wrap('error', nativeError);
	teardown.push(() => {
		console.warn = nativeWarn;
		console.error = nativeError;
	});

	if (typeof window !== 'undefined') {
		// addEventListener rather than assigning window.onerror: assignment
		// clobbers whatever else registered, including the framework.
		const onError = (event: ErrorEvent): void => {
			// Resource load failures arrive here too, with no error object and a
			// target that is not the window. They are noise.
			if (event.error == null && event.target !== window) return;
			logEntry('error', event.message, { src: 'onerror', error: event.error });
		};
		const onRejection = (event: PromiseRejectionEvent): void => {
			logEntry('error', 'unhandled rejection', {
				src: 'unhandledrejection',
				error: event.reason
			});
		};
		const onHide = (): void => {
			if (document.visibilityState === 'hidden') mirrorNow();
		};

		window.addEventListener('error', onError, true);
		window.addEventListener('unhandledrejection', onRejection);
		window.addEventListener('pagehide', mirrorNow);
		document.addEventListener('visibilitychange', onHide);
		teardown.push(() => {
			window.removeEventListener('error', onError, true);
			window.removeEventListener('unhandledrejection', onRejection);
			window.removeEventListener('pagehide', mirrorNow);
			document.removeEventListener('visibilitychange', onHide);
		});
	}

	logEntry('info', `TilePier ${meta.version} ${meta.sha} ${meta.uaBrand} ${meta.locale}`, {
		src: 'boot'
	});

	return () => {
		for (const off of teardown) off();
		teardown = [];
		installed = false;
	};
}
