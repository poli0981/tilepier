import { SvelteMap } from 'svelte/reactivity';

/**
 * What a tile's data looks like right now, published to its host header.
 *
 * doc 13 §7 puts the stale badge in the tile header, and doc 13 §3 recorded why
 * it was not there: `TpWidgetHost` is mounted imperatively by `TpGrid` from an
 * event handler, so a new prop would have to be owned by `TpGrid` — which has
 * no access to a widget's `swr` handle and no business having one. That note
 * asked for the decision to be taken rather than inherited, and this is it.
 *
 * **A module needs no prop.** The host imports this file and reads it with
 * `$derived`; the `mount()` boundary a prop cannot cross is simply not in the
 * way. Each host is its own reactive root, and a `SvelteMap` read registers
 * with whichever derived is running.
 *
 * Keyed by `instanceId`, not by data key. `swr` keys by data key because it
 * dedupes *requests*; a header dedupes nothing — two weather tiles on one place
 * share a fetch and are still two headers.
 *
 * Rune-free on purpose, which is what lets the filename stay `.ts`:
 * `SvelteMap`'s reactivity is compiled inside the `svelte` package rather than
 * by the rune transform, so this module owns state without owning a rune. It
 * also owns no timer — see `age` below.
 */

/** Not exported: every caller reaches it through `TpTileStatus`, and knip is
 *  CI-blocking on an export nothing imports. */
type TpTileStatusKind = 'stale' | 'stale-error' | 'offline';

export interface TpTileStatus {
	kind: TpTileStatusKind;
	/**
	 * The age line, already localised, or `''` when there is nothing to say.
	 *
	 * A formatted string rather than a timestamp, and that is a deliberate
	 * trade. The host would otherwise need its own 30-second heartbeat to keep
	 * "from 12 minutes ago" honest, once per tile on the deck — while every
	 * networked widget already ticks one for its own body copy. Handing the
	 * finished text over reuses the heartbeat that exists instead of adding one
	 * per host, and keeps this module free of both a timer and a locale.
	 */
	age: string;
	/** doc 13 §7: `stale-error` adds a retry control. `null` otherwise. */
	retry: (() => void) | null;
}

const statuses = new SvelteMap<string, TpTileStatus>();

/**
 * Publishes a tile's status, or clears it with `null`.
 *
 * **Unchanged means no write**, and that guard is load-bearing rather than an
 * optimisation. `retry` is a closure; a widget that rebuilt it every render
 * would replace the stored object every render, and every host on the deck
 * would re-derive off a `SvelteMap` membership change. Widgets declare `retry`
 * as a stable function so this comparison can do its job — and it is what keeps
 * the channel usable at Week 5's 60-second markets cadence.
 *
 * Callers publish from inside `untrack`. `SvelteMap.set` reads before it
 * writes, so an effect that both depends on this map and writes to it
 * self-invalidates into `effect_update_depth_exceeded` — the same trap
 * `TpWeatherReadout.svelte` documents around `swr()`.
 */
export function setTileStatus(instanceId: string, next: TpTileStatus | null): void {
	if (next === null) {
		statuses.delete(instanceId);
		return;
	}

	const current = statuses.get(instanceId);
	if (
		current !== undefined &&
		current.kind === next.kind &&
		current.age === next.age &&
		current.retry === next.retry
	) {
		return;
	}

	statuses.set(instanceId, next);
}

/** `undefined` when the tile has nothing to report, which is the common case. */
export function tileStatus(instanceId: string): TpTileStatus | undefined {
	return statuses.get(instanceId);
}

/**
 * Diagnostics and test seam, in the shape `swrCache` and `scheduler` already
 * use. `size` is what proves a tile's entry left with it: a channel that grew
 * with every tile ever mounted would be a leak nothing else could see.
 */
export const tileStatusChannel = {
	clear(): void {
		statuses.clear();
	},
	get size(): number {
		return statuses.size;
	}
};
