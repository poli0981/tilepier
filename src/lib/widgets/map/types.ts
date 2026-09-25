/**
 * The map tile's settings, as they sit in `tp.layout.v1[].settings` (doc 05
 * §2). `map` is single-instance (doc 06 §7), so there is one home.
 */

/**
 * Where the tile looks, and what the detail measures distances from (Week 6
 * plan S6: doc 08 §5 named "home" and defined it nowhere).
 */
export interface TpMapHome {
	/** The geocoder's name, or `''` for the reader's own position — the same
	 *  convention as the weather tile's place. */
	name: string;
	lat: number;
	lon: number;
}

export interface TpMapSettings {
	home: TpMapHome | null;
	/** The home came from "use my location", so a refused permission later is
	 *  doc 06 §3's `permission-needed` rather than nothing. */
	useMyLocation: boolean;
}

/** A street-level view of a city: the tile's picture and the detail's start. */
export const HOME_ZOOM = 13;

/** Where a map with no home yet looks: the whole of Việt Nam. */
export const NO_HOME = { lat: 16.0, lon: 106.0, zoom: 4.6 } as const;
