/**
 * Weather glyphs, mapped from WMO codes (doc 12 §6).
 *
 * Separate from `names.ts`, and deliberately so. `ICON_PATHS` is reached from
 * `TpIcon` in the entry chunk, so a glyph added there costs bytes for every
 * reader including the ones who never put a weather tile on the deck. This
 * module is imported only by the weather components and lands in their chunk,
 * against the 40 KB per-tile budget rather than the 200 KB entry one
 * (doc 20 §6). `names.ts` has said this set would arrive separately since
 * Week 1.
 *
 * **Seven glyphs, not the sixteen doc 12 §6 asks for.** Week 4 came in at four
 * times its budget and the cut was taken in depth rather than in widgets
 * (doc 23's slip policy); drawing sixteen 24 px paths by hand is illustration
 * time no dependency covers. The full WMO range still maps — `wmoGlyph` folds
 * drizzle into rain, grains into snow, and hail into thunder — so nothing
 * renders as `unknown` that upstream actually sends. Widening the set later is
 * a change to this file alone.
 *
 * Same drawing language as `names.ts`: `d` attributes only, 24 px grid, stroke
 * and caps from the component.
 */

export type TpWmoGlyph =
	'clear' | 'partly-cloudy' | 'overcast' | 'fog' | 'rain' | 'snow' | 'thunder' | 'unknown';

const CLOUD = 'M7 17.5a3.5 3.5 0 0 1 .4-7 5 5 0 0 1 9.6 1.2 3.4 3.4 0 0 1-.5 5.8';

export const WMO_PATHS: Record<TpWmoGlyph, readonly string[]> = {
	clear: ['M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M12 2v2', 'M12 20v2', 'M2 12h2', 'M20 12h2'],
	'partly-cloudy': ['M15.5 8.5a4 4 0 1 0-7-2.4', CLOUD],
	overcast: [CLOUD, 'M9 7.5a5 5 0 0 1 8.6 2'],
	fog: [CLOUD, 'M5 21h14', 'M7 19.5h10'],
	rain: [CLOUD, 'M9 20l-1 2', 'M13 20l-1 2', 'M17 20l-1 2'],
	snow: [CLOUD, 'M9 21h.01', 'M13 21h.01', 'M17 21h.01', 'M11 19h.01', 'M15 19h.01'],
	thunder: [CLOUD, 'M13 19h-3l3 4-1-4h3l-3-4'],
	unknown: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M9.5 9.5a2.5 2.5 0 1 1 3 2.5v1', 'M12 17h.01']
};

/**
 * WMO 4677 → glyph.
 *
 * Total by construction: a code this build has never seen, and the `null` a
 * gap arrives as (doc 04 §5), both land on `unknown` rather than throwing or
 * rendering nothing. The reader gets a glyph that says "no reading", which is
 * true, instead of an empty box that says nothing.
 */
export function wmoGlyph(code: number | null | undefined): TpWmoGlyph {
	if (typeof code !== 'number' || !Number.isFinite(code)) return 'unknown';

	// Ranges rather than a lookup table, because WMO groups by tens and a table
	// of 100 entries would hide that structure behind transcription errors.
	if (code === 0 || code === 1) return 'clear';
	if (code === 2) return 'partly-cloudy';
	if (code === 3) return 'overcast';
	if (code === 45 || code === 48) return 'fog';
	// 51-57 drizzle and freezing drizzle, 61-67 rain and freezing rain,
	// 80-82 rain showers — one glyph, per the note above.
	if ((code >= 51 && code <= 57) || (code >= 61 && code <= 67) || (code >= 80 && code <= 82)) {
		return 'rain';
	}
	// 71-77 snow and snow grains, 85-86 snow showers.
	if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
	// 95 thunderstorm, 96/99 thunderstorm with hail.
	if (code === 95 || code === 96 || code === 99) return 'thunder';
	return 'unknown';
}
