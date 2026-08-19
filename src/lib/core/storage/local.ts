import { CORRUPT_KEY_PREFIX, LOCAL_KEYS } from '$lib/shared-constants';

/**
 * Versioned localStorage access with migrations (doc 05 §5).
 *
 * Callers pass a spec rather than a bare key plus an array, because the key,
 * the version, the migration chain, the validator and the fallback have to
 * travel together — split apart, a caller can pair the wrong two and quietly
 * migrate one key's data with another key's steps.
 *
 * `tp.legal.v1` deliberately does not use this: it ships already, is mirrored
 * pre-paint by static/boot.js, and keeps its version in `acceptedVersion`
 * rather than `schemaVersion`, so forcing it through here would distort the
 * API for exactly one caller. See `core/legal.ts`.
 */

/** The three keys of doc 05 §2. The type is the enforcement — a fourth key
 *  cannot be passed to any function here. */
type TpLocalKey = (typeof LOCAL_KEYS)[keyof typeof LOCAL_KEYS];

export interface TpVersioned {
	schemaVersion: number;
}

/** One step of a chain. `to` is the version this step produces. */
interface TpMigration {
	readonly to: number;
	migrate(old: unknown): unknown;
}

type TpReadOutcome = 'ok' | 'empty' | 'migrated' | 'quarantined' | 'unavailable';

export interface TpReadResult<T> {
	value: T;
	outcome: TpReadOutcome;
	/** Where the unusable original went, when it could be saved at all. */
	quarantineKey?: string;
}

export interface TpVersionedSpec<T extends TpVersioned> {
	readonly key: TpLocalKey;
	/** What this build writes. */
	readonly version: number;
	readonly migrations: readonly TpMigration[];
	/** Hand-written structural check — doc 05 §6 rules out a runtime schema dep. */
	validate(candidate: unknown): candidate is T;
	/** Called, not shared, so a caller cannot mutate a module-level singleton. */
	fallback(): T;
}

/**
 * A key that keeps failing to parse would otherwise fill the origin quota with
 * quarantine copies — a worse failure than the one being contained (doc 05 §5).
 */
export const MAX_QUARANTINE_PER_KEY = 3;

/**
 * Access can throw, not just be absent: Chromium raises SecurityError when
 * cookies are blocked for the origin, and prerender has no localStorage at all.
 */
function storage(): Storage | null {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
}

function schemaVersionOf(parsed: unknown): number | null {
	if (typeof parsed !== 'object' || parsed === null) return null;
	const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
	return typeof version === 'number' && Number.isFinite(version) ? version : null;
}

/**
 * Runs the chain in ascending `to` order, each step consuming the previous
 * step's output. Returns null when a step throws — the caller quarantines,
 * because a migration that explodes is no more trustworthy than bad JSON.
 */
function applyChain<T extends TpVersioned>(
	spec: TpVersionedSpec<T>,
	parsed: unknown,
	storedVersion: number
): { value: T; changed: boolean } | null {
	let current = parsed;
	let changed = false;

	const steps = [...spec.migrations].sort((a, b) => a.to - b.to);
	for (const step of steps) {
		if (step.to <= storedVersion) continue;
		try {
			current = step.migrate(current);
		} catch {
			return null;
		}
		changed = true;
	}

	// Validation runs *after* the chain: a migration that produces garbage is
	// caught here rather than being written back over good data.
	if (!spec.validate(current)) return null;
	return { value: current, changed };
}

function pruneQuarantine(store: Storage, key: TpLocalKey): void {
	const prefix = `${CORRUPT_KEY_PREFIX}${key}.`;
	const found: string[] = [];

	try {
		for (let i = 0; i < store.length; i++) {
			const candidate = store.key(i);
			if (candidate !== null && candidate.startsWith(prefix)) found.push(candidate);
		}
	} catch {
		return;
	}
	if (found.length <= MAX_QUARANTINE_PER_KEY) return;

	// Sort numerically on the timestamp suffix rather than lexicographically:
	// string order only matches time order until Date.now() gains a digit.
	found.sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)));
	for (const stale of found.slice(0, found.length - MAX_QUARANTINE_PER_KEY)) {
		try {
			store.removeItem(stale);
		} catch {
			// Nothing better to do; the cap is best-effort by nature.
		}
	}
}

/** Moves an unusable raw value aside and returns where it went, or null. */
function quarantine(key: TpLocalKey, raw: string): string | null {
	const store = storage();
	if (store === null) return null;

	const stamp = Date.now();
	let target = `${CORRUPT_KEY_PREFIX}${key}.${stamp}`;
	// Two failures inside one millisecond must not overwrite each other. The
	// `.n` suffix still parses as a float, so pruneQuarantine's sort holds.
	for (let n = 1; store.getItem(target) !== null; n++) {
		target = `${CORRUPT_KEY_PREFIX}${key}.${stamp}.${n}`;
	}

	try {
		store.setItem(target, raw);
	} catch {
		return null;
	}
	pruneQuarantine(store, key);
	return target;
}

function resetTo<T extends TpVersioned>(spec: TpVersionedSpec<T>, raw: string): TpReadResult<T> {
	const quarantineKey = quarantine(spec.key, raw);
	const value = spec.fallback();
	writeVersioned(spec, value);
	// exactOptionalPropertyTypes: the field is omitted, never set to undefined.
	return quarantineKey === null
		? { value, outcome: 'quarantined' }
		: { value, outcome: 'quarantined', quarantineKey };
}

export function readVersioned<T extends TpVersioned>(spec: TpVersionedSpec<T>): TpReadResult<T> {
	const store = storage();
	if (store === null) return { value: spec.fallback(), outcome: 'unavailable' };

	let raw: string | null;
	try {
		raw = store.getItem(spec.key);
	} catch {
		return { value: spec.fallback(), outcome: 'unavailable' };
	}
	if (raw === null) return { value: spec.fallback(), outcome: 'empty' };

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return resetTo(spec, raw);
	}

	const stored = schemaVersionOf(parsed);
	if (stored === null) return resetTo(spec, raw);

	// Written by a newer build. doc 05 §5 covers corruption but not downgrade;
	// they get the same treatment, because guessing at a shape this build has
	// never seen is how a shell crashes after a rollback.
	if (stored > spec.version) return resetTo(spec, raw);

	const result = applyChain(spec, parsed, stored);
	if (result === null) return resetTo(spec, raw);

	// One write for the whole chain, not one per step (doc 05 §5).
	if (result.changed) writeVersioned(spec, result.value);
	return { value: result.value, outcome: result.changed ? 'migrated' : 'ok' };
}

/**
 * Returns false rather than throwing on a full or unavailable store: private
 * mode must not take the shell down. `core/legal.ts` takes the same line.
 */
export function writeVersioned<T extends TpVersioned>(spec: TpVersionedSpec<T>, value: T): boolean {
	const store = storage();
	if (store === null) return false;
	try {
		store.setItem(spec.key, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}

/**
 * Cross-tab sync (doc 04 §7). `null` means the value went away — another tab
 * cleared storage or removed the key — and the caller should fall back.
 *
 * Deliberately does not quarantine: the tab that wrote the bad value already
 * did, and two tabs racing to quarantine the same string produces two copies
 * against a cap of three.
 */
export function subscribeVersioned<T extends TpVersioned>(
	spec: TpVersionedSpec<T>,
	onExternal: (next: T | null) => void
): () => void {
	if (typeof window === 'undefined') return () => {};

	function handle(event: StorageEvent): void {
		// sessionStorage raises the same event type.
		if (event.storageArea !== storage()) return;
		// key === null is storage.clear() — it concerns every key, including ours.
		if (event.key === null || event.newValue === null) {
			if (event.key === null || event.key === spec.key) onExternal(null);
			return;
		}
		if (event.key !== spec.key) return;

		let parsed: unknown;
		try {
			parsed = JSON.parse(event.newValue);
		} catch {
			return;
		}
		const stored = schemaVersionOf(parsed);
		if (stored === null || stored > spec.version) return;

		const result = applyChain(spec, parsed, stored);
		if (result !== null) onExternal(result.value);
	}

	window.addEventListener('storage', handle);
	return () => window.removeEventListener('storage', handle);
}
