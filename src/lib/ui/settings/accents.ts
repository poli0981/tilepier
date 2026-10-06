/**
 * The accent swatches Settings offers (doc 12 §2): the accent is
 * user-overridable, semantic colours are not. Data the reader picks from, not
 * styling — the one place a literal colour is right — and a module of its own
 * so the contrast suite (`ui/contrast.svelte.test.ts`) checks the same six the
 * panel shows.
 */
export const ACCENTS = ['#46d5c8', '#7b8ff2', '#e8b750', '#57c785', '#e8705f', '#b48ce8'] as const;

/** What a screen reader says for each swatch, in ACCENTS' order: a colour's
 *  name, never six hex digits. Each is a `settings.appearance.accent_*` message. */
export const ACCENT_NAMES = ['teal', 'blue', 'amber', 'green', 'coral', 'violet'] as const;
