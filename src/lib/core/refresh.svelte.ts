import type { TpRefresh } from './registry';
import { scheduler, type TpTaskOptions } from './scheduler';

/**
 * Registers a widget's `refresh` cadence with the central scheduler, and
 * unregisters it on unmount (doc 04 §3, "Who registers").
 *
 * `TpWidgetHost` used to do this. It could not: `scheduler.register` refcounts
 * by id and the first registration's options win, so the host's placeholder
 * `run` would have swallowed the widget's real one. The registration therefore
 * lives one component deeper, in the widget that has something to run — which
 * leaves doc 19 §6's "no scheduler leaks on remove" exactly as structural as it
 * was, because a widget unmounts with its host.
 *
 * The `.svelte.ts` infix is required: this calls `$effect`, so it must be
 * invoked during a component's initialisation, like any other rune.
 *
 * `id` is the caller's choice, per doc 04 §3. A local-only widget passes its
 * `instanceId`; a networked one passes its data key, so two tiles pinned to the
 * same place share one entry instead of fetching the same payload twice.
 */
export function useRefresh(
	id: string,
	cadence: TpRefresh,
	run: TpTaskOptions['run'],
	options: { label?: string; runOnFocus?: boolean; runOnRegister?: boolean } = {}
): void {
	$effect(() => {
		// `manual` means no scheduler entry at all (doc 06 §7's `—` rows), and
		// registering one would put a row in the diagnostics table for a task
		// that can never come due.
		if (cadence.kind === 'manual') return;

		// Every value read here is a plain parameter rather than a rune, so this
		// effect has no dependencies and runs exactly once per mount. That is
		// deliberate: re-registering on a prop change would tear down and rebuild
		// the entry, losing its `lastRunAt` and re-running it immediately.
		const handle = scheduler.register(id, { cadence, run, ...options });
		return () => handle.unregister();
	});
}
