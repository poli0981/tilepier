import { parseHex, toHex } from './color';
import { isToolboxTab, RECENT_COLORS_MAX, type TpToolboxSettings } from './types';

/**
 * doc 07 §7's settings reader, and the one piece of state that outlives a
 * session: the recent-colour list.
 *
 * Hand-written and total, like every other reader of stored data here (doc 05
 * §5 forbids a runtime schema dependency): a settings bag can hold anything a
 * previous build, a backup file or a hand edit put in it.
 */

export function readSettings(bag: Record<string, unknown>): TpToolboxSettings {
	const tab = bag['tab'];
	const recent = bag['recentColors'];

	return {
		tab: isToolboxTab(tab) ? tab : 'qr',
		recentColors: Array.isArray(recent)
			? recent
					// Re-normalised through the parser rather than trusted: what is
					// stored has to be a colour the swatch can actually render.
					.map((value) => (typeof value === 'string' ? parseHex(value) : null))
					.filter((rgb) => rgb !== null)
					.map((rgb) => toHex(rgb))
					.slice(0, RECENT_COLORS_MAX)
			: []
	};
}

/**
 * Newest first, no duplicates, capped. Re-picking a colour already in the list
 * moves it to the front rather than adding a second copy — eight slots is few
 * enough that a duplicate costs a real one.
 */
export function pushRecentColor(recent: readonly string[], hex: string): string[] {
	const rgb = parseHex(hex);
	if (rgb === null) return [...recent];

	const normalised = toHex(rgb);
	return [normalised, ...recent.filter((entry) => entry !== normalised)].slice(
		0,
		RECENT_COLORS_MAX
	);
}
