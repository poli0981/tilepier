import { defineCustomClientStrategy, getLocale, isLocale, locales } from '$lib/paraglide/runtime';
import { settings } from '$lib/stores/settings.svelte';

/**
 * Locale plumbing (doc 14 §1).
 *
 * The locale lives in `tp.settings.v1`, not in the URL and not in a key of
 * Paraglide's own. The built-in `localStorage` strategy would write
 * `PARAGLIDE_LOCALE`, which is a fourth localStorage key and forbidden by
 * doc 05 §2 — so the settings store backs a custom strategy instead.
 */

/** Must match the compiler's `strategy` option in vite.config.ts. */
const TP_STRATEGY = 'custom-tpsettings';

export type TpLocale = (typeof locales)[number];

export const LOCALES: readonly TpLocale[] = locales;

/**
 * Registered from `hooks.client.ts` `init`, which SvelteKit awaits before
 * hydration — that ordering is what guarantees no `m.*()` call resolves before
 * the strategy exists. Idempotent, because the runtime keeps handlers in a Map.
 */
export function installLocaleStrategy(): void {
	defineCustomClientStrategy(TP_STRATEGY, {
		getLocale: () => settings.locale,
		setLocale: (locale) => {
			if (!isLocale(locale)) return;
			if (locale === settings.locale) return;
			// Deferred, because Paraglide calls this from inside getLocale() the
			// first time a message resolves (runtime.js: `setLocale(resolved,
			// { reload: false })` once `localeInitiallySet` flips). That first
			// call almost always happens inside a component render, and a rune
			// mutation there is `state_unsafe_mutation`. The equality guard above
			// makes the write-back a no-op in practice; this covers the case
			// where a later strategy genuinely resolved something else.
			queueMicrotask(() => settings.patch({ locale }));
		}
	});

	// Resolve once here, outside any render, so `localeInitiallySet` flips in a
	// context where a write-back would be safe rather than mid-component.
	getLocale();
}
