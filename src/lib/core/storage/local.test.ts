import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CORRUPT_KEY_PREFIX, LOCAL_KEYS } from '$lib/shared-constants';
import {
	MAX_QUARANTINE_PER_KEY,
	readVersioned,
	subscribeVersioned,
	writeVersioned,
	type TpVersioned,
	type TpVersionedSpec
} from './local';

/**
 * doc 19 §3.3: every localStorage migration gets an old-shape → new-shape test
 * and a corrupt-JSON quarantine test.
 *
 * The Storage stub lives in this file rather than in a setup file: the node
 * project has no setupFiles, and a helper that only one suite uses is clearer
 * next to the suite.
 */

class MemoryStorage implements Storage {
	#map = new Map<string, string>();
	/** Set to make setItem throw, standing in for private mode / full quota. */
	failWrites = false;

	get length(): number {
		return this.#map.size;
	}
	key(index: number): string | null {
		return [...this.#map.keys()][index] ?? null;
	}
	getItem(key: string): string | null {
		return this.#map.get(key) ?? null;
	}
	setItem(key: string, value: string): void {
		if (this.failWrites) {
			const error = new Error('quota');
			error.name = 'QuotaExceededError';
			throw error;
		}
		this.#map.set(key, value);
	}
	removeItem(key: string): void {
		this.#map.delete(key);
	}
	clear(): void {
		this.#map.clear();
	}
}

interface Sample extends TpVersioned {
	schemaVersion: 2;
	label: string;
}

function sampleSpec(overrides: Partial<TpVersionedSpec<Sample>> = {}): TpVersionedSpec<Sample> {
	return {
		key: LOCAL_KEYS.settings,
		version: 2,
		migrations: [
			{
				to: 2,
				migrate: (old) => ({
					schemaVersion: 2,
					label: String((old as { name?: unknown }).name ?? 'unnamed')
				})
			}
		],
		validate: (c): c is Sample =>
			typeof c === 'object' &&
			c !== null &&
			(c as Sample).schemaVersion === 2 &&
			typeof (c as Sample).label === 'string',
		fallback: () => ({ schemaVersion: 2, label: 'default' }),
		...overrides
	};
}

let store: MemoryStorage;

beforeEach(() => {
	store = new MemoryStorage();
	vi.stubGlobal('localStorage', store);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('readVersioned', () => {
	it('falls back when the key has never been written', () => {
		const result = readVersioned(sampleSpec());

		expect(result.outcome).toBe('empty');
		expect(result.value.label).toBe('default');
		// A read must not create the key — an untouched install stays untouched.
		expect(store.getItem(LOCAL_KEYS.settings)).toBeNull();
	});

	it('returns a current-version value untouched', () => {
		store.setItem(LOCAL_KEYS.settings, JSON.stringify({ schemaVersion: 2, label: 'kept' }));

		const result = readVersioned(sampleSpec());

		expect(result.outcome).toBe('ok');
		expect(result.value.label).toBe('kept');
	});

	it('runs the chain in ascending order and writes back exactly once', () => {
		store.setItem(LOCAL_KEYS.settings, JSON.stringify({ schemaVersion: 0, name: 'old' }));
		const order: number[] = [];
		const spec = sampleSpec({
			version: 3,
			// Declared out of order on purpose: the reader sorts, callers should
			// not have to.
			migrations: [
				{
					to: 3,
					migrate: (old) => {
						order.push(3);
						return { ...(old as object), schemaVersion: 3 };
					}
				},
				{
					to: 1,
					migrate: (old) => {
						order.push(1);
						return { ...(old as object), schemaVersion: 1, name: 'v1' };
					}
				},
				{
					to: 2,
					migrate: (old) => {
						order.push(2);
						return { schemaVersion: 2, label: String((old as { name: string }).name) };
					}
				}
			],
			validate: (c): c is Sample =>
				typeof c === 'object' && c !== null && typeof (c as Sample).label === 'string'
		});
		const setItem = vi.spyOn(store, 'setItem');

		const result = readVersioned(spec);

		expect(order).toEqual([1, 2, 3]);
		expect(result.outcome).toBe('migrated');
		expect(result.value.label).toBe('v1');
		expect(setItem).toHaveBeenCalledTimes(1);
	});

	it('skips migration steps at or below the stored version', () => {
		store.setItem(LOCAL_KEYS.settings, JSON.stringify({ schemaVersion: 2, label: 'current' }));
		const migrate = vi.fn();

		const result = readVersioned(sampleSpec({ migrations: [{ to: 2, migrate }] }));

		expect(migrate).not.toHaveBeenCalled();
		expect(result.outcome).toBe('ok');
	});

	it('quarantines unparseable JSON and starts fresh', () => {
		store.setItem(LOCAL_KEYS.settings, '{not json');

		const result = readVersioned(sampleSpec());

		expect(result.outcome).toBe('quarantined');
		expect(result.value.label).toBe('default');
		expect(result.quarantineKey).toMatch(
			new RegExp(`^${CORRUPT_KEY_PREFIX.replace('.', '\\.')}tp\\.settings\\.v1\\.\\d+`)
		);
		// The original survives for diagnosis, and the live key is usable again.
		expect(store.getItem(result.quarantineKey as string)).toBe('{not json');
		expect(JSON.parse(store.getItem(LOCAL_KEYS.settings) as string)).toEqual({
			schemaVersion: 2,
			label: 'default'
		});
	});

	it('quarantines a missing or non-numeric schemaVersion', () => {
		store.setItem(LOCAL_KEYS.settings, JSON.stringify({ label: 'no version' }));

		expect(readVersioned(sampleSpec()).outcome).toBe('quarantined');
	});

	it('quarantines a value written by a newer build rather than guessing', () => {
		store.setItem(LOCAL_KEYS.settings, JSON.stringify({ schemaVersion: 99, label: 'future' }));

		const result = readVersioned(sampleSpec());

		expect(result.outcome).toBe('quarantined');
		expect(result.value.label).toBe('default');
	});

	it('quarantines when a migration throws', () => {
		store.setItem(LOCAL_KEYS.settings, JSON.stringify({ schemaVersion: 1, name: 'x' }));

		const result = readVersioned(
			sampleSpec({
				migrations: [
					{
						to: 2,
						migrate: () => {
							throw new Error('bad step');
						}
					}
				]
			})
		);

		expect(result.outcome).toBe('quarantined');
	});

	it('quarantines when validation fails after a migration produced garbage', () => {
		store.setItem(LOCAL_KEYS.settings, JSON.stringify({ schemaVersion: 1, name: 'x' }));

		const result = readVersioned(
			sampleSpec({ migrations: [{ to: 2, migrate: () => ({ schemaVersion: 2 }) }] })
		);

		// Garbage must not be written back over the key.
		expect(result.outcome).toBe('quarantined');
		expect(result.value.label).toBe('default');
	});

	it('keeps at most three quarantine copies, dropping the oldest', () => {
		const spec = sampleSpec();
		const stamps = [1000, 2000, 3000, 4000];

		for (const stamp of stamps) {
			vi.spyOn(Date, 'now').mockReturnValue(stamp);
			store.setItem(LOCAL_KEYS.settings, '{broken');
			readVersioned(spec);
		}

		const kept = Array.from({ length: store.length }, (_, i) => store.key(i)).filter(
			(k): k is string => k !== null && k.startsWith(CORRUPT_KEY_PREFIX)
		);

		expect(kept).toHaveLength(MAX_QUARANTINE_PER_KEY);
		expect(kept.some((k) => k.endsWith('.1000'))).toBe(false);
		expect(kept.some((k) => k.endsWith('.4000'))).toBe(true);
	});

	it('does not overwrite a quarantine copy made in the same millisecond', () => {
		vi.spyOn(Date, 'now').mockReturnValue(5000);
		const spec = sampleSpec();

		store.setItem(LOCAL_KEYS.settings, '{first');
		const first = readVersioned(spec).quarantineKey as string;
		store.setItem(LOCAL_KEYS.settings, '{second');
		const second = readVersioned(spec).quarantineKey as string;

		expect(first).not.toBe(second);
		expect(store.getItem(first)).toBe('{first');
		expect(store.getItem(second)).toBe('{second');
	});

	it('reports unavailable rather than throwing when there is no storage', () => {
		vi.stubGlobal('localStorage', undefined);

		const result = readVersioned(sampleSpec());

		expect(result.outcome).toBe('unavailable');
		expect(result.value.label).toBe('default');
	});
});

describe('writeVersioned', () => {
	it('returns false on a quota error instead of taking the shell down', () => {
		store.failWrites = true;

		expect(writeVersioned(sampleSpec(), { schemaVersion: 2, label: 'x' })).toBe(false);
	});

	it('returns true on success', () => {
		expect(writeVersioned(sampleSpec(), { schemaVersion: 2, label: 'x' })).toBe(true);
		expect(store.getItem(LOCAL_KEYS.settings)).toContain('"label":"x"');
	});
});

describe('subscribeVersioned', () => {
	function fireStorage(init: Partial<StorageEvent>): void {
		const event = new Event('storage') as StorageEvent & Record<string, unknown>;
		Object.assign(event, { key: null, newValue: null, storageArea: store, ...init });
		window.dispatchEvent(event);
	}

	beforeEach(() => {
		// The node project has no DOM; a minimal window is enough to exercise
		// the listener wiring, which is all this module owns.
		const listeners = new Map<string, EventListener[]>();
		vi.stubGlobal('window', {
			addEventListener: (type: string, fn: EventListener) => {
				listeners.set(type, [...(listeners.get(type) ?? []), fn]);
			},
			removeEventListener: (type: string, fn: EventListener) => {
				listeners.set(
					type,
					(listeners.get(type) ?? []).filter((l) => l !== fn)
				);
			},
			dispatchEvent: (event: Event) => {
				for (const fn of listeners.get(event.type) ?? []) fn(event);
				return true;
			}
		});
	});

	it('delivers a migrated value from another tab', () => {
		const seen: (Sample | null)[] = [];
		subscribeVersioned(sampleSpec(), (next) => seen.push(next));

		fireStorage({
			key: LOCAL_KEYS.settings,
			newValue: JSON.stringify({ schemaVersion: 1, name: 'from other tab' })
		});

		expect(seen).toEqual([{ schemaVersion: 2, label: 'from other tab' }]);
	});

	it('ignores events for other keys and other storage areas', () => {
		const seen: (Sample | null)[] = [];
		subscribeVersioned(sampleSpec(), (next) => seen.push(next));

		fireStorage({ key: LOCAL_KEYS.layout, newValue: '{"schemaVersion":2,"label":"nope"}' });
		fireStorage({
			key: LOCAL_KEYS.settings,
			newValue: '{"schemaVersion":2,"label":"nope"}',
			storageArea: new MemoryStorage()
		});

		expect(seen).toEqual([]);
	});

	it('reports null when the key is removed or storage is cleared', () => {
		const seen: (Sample | null)[] = [];
		subscribeVersioned(sampleSpec(), (next) => seen.push(next));

		fireStorage({ key: LOCAL_KEYS.settings, newValue: null });
		fireStorage({ key: null, newValue: null });

		expect(seen).toEqual([null, null]);
	});

	it('does not quarantine bad values — the writing tab already did', () => {
		const seen: (Sample | null)[] = [];
		subscribeVersioned(sampleSpec(), (next) => seen.push(next));

		fireStorage({ key: LOCAL_KEYS.settings, newValue: '{not json' });

		expect(seen).toEqual([]);
		expect(store.length).toBe(0);
	});

	it('stops delivering after unsubscribe', () => {
		const seen: (Sample | null)[] = [];
		const off = subscribeVersioned(sampleSpec(), (next) => seen.push(next));

		off();
		fireStorage({ key: LOCAL_KEYS.settings, newValue: '{"schemaVersion":2,"label":"late"}' });

		expect(seen).toEqual([]);
	});
});
