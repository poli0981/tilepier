import { LOCAL_KEYS } from '$lib/shared-constants';
import {
	readVersioned,
	subscribeVersioned,
	writeVersioned,
	type TpVersionedSpec
} from '$lib/core/storage/local';

/**
 * App settings (`tp.settings.v1`, doc 05 §2) and the post-hydration owner of
 * the `<html>` attributes that describe them (doc 13 §10).
 *
 * Division of labour with static/boot.js: boot.js is the *reader* before first
 * paint and sets `data-theme` / `lang` so nothing flashes; this store is the
 * *writer* and takes ownership once the app hydrates. Both resolve the same
 * defaults, and `core/legal.test.ts` asserts the two stay in step — duplicated
 * logic is only safe when something notices it drifting.
 */

// These stay unexported until something outside this module names one.
// Consumers read them structurally through TpSettings; knip is CI-blocking on
// unused exports, so a type is exported at the commit that first imports it.
type TpLocale = 'vi' | 'en';
type TpTheme = 'dark' | 'light' | 'system';
type TpReducedMotion = 'system' | 'on' | 'off';

export interface TpSettings {
	schemaVersion: 1;
	locale: TpLocale;
	theme: TpTheme;
	accent: string;
	clock24h: boolean;
	weekStartsOn: 0 | 1;
	reducedMotion: TpReducedMotion;
	/** doc 13 §9 first-run coach, "dismiss forever". */
	coachDismissed: boolean;
	/** doc 18 §5 diagnostics panel. Lives here rather than as a fourth key. */
	debug: boolean;
}

const LOCALES: readonly TpLocale[] = ['vi', 'en'];

/** Matches `--color-beacon` in app.css (doc 12 §2). Duplicated deliberately:
 *  the default has to exist before any stylesheet has been parsed. */
const DEFAULT_ACCENT = '#46d5c8';

const SETTINGS_VERSION = 1;

/** Must stay identical to the detection in static/boot.js (doc 14 §1). */
function detectLocale(): TpLocale {
	if (typeof navigator === 'undefined') return 'en';
	return (navigator.language || 'en').toLowerCase().startsWith('vi') ? 'vi' : 'en';
}

export function defaultSettings(): TpSettings {
	const locale = detectLocale();
	return {
		schemaVersion: SETTINGS_VERSION,
		locale,
		theme: 'system',
		accent: DEFAULT_ACCENT,
		clock24h: true,
		// doc 14 §3: vi defaults to Monday, en follows locale data — which for
		// en-US is Sunday. A user override wins over both.
		weekStartsOn: locale === 'vi' ? 1 : 0,
		reducedMotion: 'system',
		coachDismissed: false,
		debug: false
	};
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
	return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

/** Hand-written per doc 05 §6 — no runtime schema dependency. */
function isSettings(candidate: unknown): candidate is TpSettings {
	if (typeof candidate !== 'object' || candidate === null) return false;
	const s = candidate as Record<string, unknown>;
	return (
		s['schemaVersion'] === SETTINGS_VERSION &&
		isOneOf(s['locale'], LOCALES) &&
		isOneOf(s['theme'], ['dark', 'light', 'system'] as const) &&
		typeof s['accent'] === 'string' &&
		typeof s['clock24h'] === 'boolean' &&
		(s['weekStartsOn'] === 0 || s['weekStartsOn'] === 1) &&
		isOneOf(s['reducedMotion'], ['system', 'on', 'off'] as const) &&
		typeof s['coachDismissed'] === 'boolean' &&
		typeof s['debug'] === 'boolean'
	);
}

const SETTINGS_SPEC: TpVersionedSpec<TpSettings> = {
	key: LOCAL_KEYS.settings,
	version: SETTINGS_VERSION,
	// Nothing has shipped at v1 yet, so there is nothing to migrate from.
	// Appending here is how v2 lands; never edit a step that has shipped.
	migrations: [],
	validate: isSettings,
	fallback: defaultSettings
};

class SettingsStore {
	#value = $state<TpSettings>(defaultSettings());
	#systemDark = $state(true);
	#systemReducedMotion = $state(false);
	#teardown: (() => void)[] = [];
	#hydrated = false;

	get locale(): TpLocale {
		return this.#value.locale;
	}
	get theme(): TpTheme {
		return this.#value.theme;
	}
	get accent(): string {
		return this.#value.accent;
	}
	get clock24h(): boolean {
		return this.#value.clock24h;
	}
	get weekStartsOn(): 0 | 1 {
		return this.#value.weekStartsOn;
	}
	get reducedMotion(): TpReducedMotion {
		return this.#value.reducedMotion;
	}
	get coachDismissed(): boolean {
		return this.#value.coachDismissed;
	}
	get debug(): boolean {
		return this.#value.debug;
	}

	/** `'system'` resolved against the media query, for anything that needs a
	 *  concrete answer (the ECharts theme bridge, doc 12 §2). */
	get resolvedTheme(): 'dark' | 'light' {
		if (this.#value.theme !== 'system') return this.#value.theme;
		return this.#systemDark ? 'dark' : 'light';
	}

	/**
	 * doc 12 §7: components never read the media query themselves, so that the
	 * settings override and the OS preference are combined in exactly one place.
	 */
	get motionOK(): boolean {
		if (this.#value.reducedMotion === 'on') return false;
		if (this.#value.reducedMotion === 'off') return true;
		return !this.#systemReducedMotion;
	}

	/** Plain copy for the exporter and the doc 18 §2 environment block. */
	get snapshot(): Readonly<TpSettings> {
		return { ...this.#value };
	}

	/** Idempotent: reads storage, starts the media-query and cross-tab listeners. */
	hydrate(): void {
		if (this.#hydrated) return;
		this.#hydrated = true;

		this.#value = readVersioned(SETTINGS_SPEC).value;

		if (typeof window === 'undefined') return;

		this.#watch('(prefers-color-scheme: dark)', (m) => (this.#systemDark = m));
		this.#watch('(prefers-reduced-motion: reduce)', (m) => (this.#systemReducedMotion = m));

		this.#teardown.push(
			subscribeVersioned(SETTINGS_SPEC, (next) => {
				const incoming = next ?? defaultSettings();
				// A locale change in another tab cannot be applied in place:
				// Paraglide messages are resolved at call time and the shell is
				// already rendered. Reloading is one line against a whole
				// invalidation graph, and doc 14 §1 already reloads on switch.
				const localeChanged = incoming.locale !== this.#value.locale;
				this.#value = incoming;
				if (localeChanged) location.reload();
			})
		);
	}

	#watch(query: string, apply: (matched: boolean) => void): void {
		const mq = window.matchMedia(query);
		apply(mq.matches);
		const listener = (event: MediaQueryListEvent): void => apply(event.matches);
		mq.addEventListener('change', listener);
		this.#teardown.push(() => mq.removeEventListener('change', listener));
	}

	patch(partial: Partial<Omit<TpSettings, 'schemaVersion'>>): void {
		this.#value = { ...this.#value, ...partial };
		writeVersioned(SETTINGS_SPEC, this.#value);
	}

	reset(): void {
		this.#value = defaultSettings();
		writeVersioned(SETTINGS_SPEC, this.#value);
	}

	/**
	 * Mirrors settings onto `<html>`. Called from a `$effect` in the root
	 * layout — reading the state here is what makes that effect re-run.
	 *
	 * Only `--color-beacon` is set: the soft and deep variants are derived with
	 * `color-mix(in oklch, …)` in app.css, so a custom accent stays usable in
	 * both themes without shipping a colour module (doc 12 §2).
	 */
	applyToDocument(): void {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		root.setAttribute('data-theme', this.resolvedTheme);
		root.setAttribute('lang', this.#value.locale);
		root.setAttribute('data-motion', this.motionOK ? 'ok' : 'reduced');
		root.style.setProperty('--color-beacon', this.#value.accent);
	}

	dispose(): void {
		for (const off of this.#teardown) off();
		this.#teardown = [];
		this.#hydrated = false;
	}
}

export const settings = new SettingsStore();
