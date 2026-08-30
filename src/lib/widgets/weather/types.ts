/**
 * doc 08 §1. The place lives in the *tile's* `settings` bag inside
 * `tp.layout.v1` (doc 05 §2), not in a shared store, because doc 06 §7 makes
 * `weather` multi-instance "per-place": two tiles are two places, and the deck
 * is what remembers which.
 *
 * Nothing here is a coordinate the reader typed. `lat`/`lon` are already
 * rounded to 2 dp before they are written (doc 16 §3, doc 15 §7), so the most
 * precise thing this file can persist is a ~1 km square.
 */

export interface TpWeatherPlace {
	/** From `/api/geocode`, or the reverse lookup for "use my location". A text
	 *  node wherever it renders — never `{@html}` (CLAUDE.md rule 7). */
	name: string;
	/** 2 dp. Rounded on the device before the first request leaves it. */
	lat: number;
	lon: number;
}

export interface TpWeatherSettings {
	/**
	 * `null` is the normal first-run state, not an error: doc 13 §9 seeds a
	 * weather tile deliberately empty so the reader picks their own place. It is
	 * what the tile renders as doc 06 §3's `empty`.
	 */
	place: TpWeatherPlace | null;
	/** The reader asked for browser geolocation. Kept so a denied permission can
	 *  be told apart from never having asked (doc 06 §3 `permission-needed`). */
	useMyLocation: boolean;
}

export const WEATHER_DEFAULTS: TpWeatherSettings = {
	place: null,
	useMyLocation: false
};

/** doc 08 §1: the 12-hour sparkline, at h≥3. */
export const SPARKLINE_HOURS = 12;
