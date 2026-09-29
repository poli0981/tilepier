/**
 * The internal icon set (doc 12 §6): 1.75 px stroke on a 24 px grid, round
 * caps, Lucide-style geometry adapted by hand. One set, no icon library
 * dependency, no emoji anywhere in UI chrome.
 *
 * Paths live in one record rather than one module per glyph so that adding a
 * glyph does not add an export knip has to be told about. The set grows with
 * the widgets that need it — doc 12 §6's 16-glyph WMO weather set is separate
 * and arrives in Week 4.
 */

export type TpIconName =
	| 'clock'
	| 'timer'
	| 'calculator'
	| 'note'
	| 'check'
	| 'calendar'
	| 'toolbox'
	| 'cloud'
	| 'coins'
	| 'quote'
	| 'rss'
	| 'map'
	| 'chart'
	| 'music'
	| 'film'
	| 'play'
	| 'pause'
	| 'prev'
	| 'next'
	| 'shuffle'
	| 'repeat'
	| 'repeat-one'
	| 'volume'
	| 'mute'
	| 'folder'
	| 'upload'
	| 'plus'
	| 'close'
	| 'expand'
	| 'settings'
	| 'trash'
	| 'search'
	| 'locate'
	| 'refresh'
	| 'swap'
	| 'chevron'
	| 'edit';

/** `d` attributes only; stroke, size and caps come from the component. */
export const ICON_PATHS: Record<TpIconName, readonly string[]> = {
	clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
	// Retry, on the tile-status badge. The expand glyph stood in for it while the
	// badge lived in the weather body, which read as “open” rather than “try again”.
	refresh: ['M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8', 'M21 3v5h-5'],
	// Swap the pair, on the currency tile: two lanes running opposite ways.
	swap: ['M8 3 4 7l4 4', 'M4 7h16', 'M16 21l4-4-4-4', 'M20 17H4'],
	// Points down; the currency detail rotates it for "move up". One glyph for one
	// idea, because two would drift apart the first time either is touched.
	chevron: ['M6 9l6 6 6-6'],
	timer: ['M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M12 10v4', 'M9 2h6'],
	calculator: ['M5 3h14v18H5z', 'M8 7h8', 'M8 12h.01', 'M12 12h.01', 'M16 12h.01', 'M8 16h8'],
	note: ['M5 3h9l5 5v13H5z', 'M14 3v5h5', 'M9 13h6', 'M9 17h4'],
	check: ['M4 12l5 5L20 6'],
	calendar: ['M4 5h16v16H4z', 'M4 10h16', 'M8 3v4', 'M16 3v4'],
	toolbox: ['M3 8h18v12H3z', 'M8 8V5h8v3', 'M3 13h18'],
	cloud: ['M7 18a4 4 0 0 1 .5-8 5.5 5.5 0 0 1 10.6 1.4A3.5 3.5 0 0 1 17.5 18z'],
	coins: ['M9 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z', 'M14 20a5 5 0 1 0 0-10', 'M14 10h.01'],
	quote: ['M7 7h4v6a4 4 0 0 1-4 4', 'M15 7h4v6a4 4 0 0 1-4 4'],
	rss: ['M5 19h.01', 'M4 11a9 9 0 0 1 9 9', 'M4 4a16 16 0 0 1 16 16'],
	map: ['M9 4 3 7v13l6-3 6 3 6-3V4l-6 3z', 'M9 4v13', 'M15 7v13'],
	chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
	// A strip of film: the frame and its sprocket holes (Week 7b, media).
	film: [
		'M4 4h16v16H4z',
		'M8 4v16',
		'M16 4v16',
		'M4 8h4',
		'M4 12h4',
		'M4 16h4',
		'M16 8h4',
		'M16 12h4',
		'M16 16h4'
	],
	music: [
		'M9 18V6l11-2v12',
		'M9 18a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z',
		'M20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z'
	],
	play: ['M7 4l13 8-13 8z'],
	// The music player's transport (Week 7). Drawn to sit beside `play`: the
	// same 4–20 vertical extent, the same weight, no fills.
	pause: ['M7 5h3v14H7z', 'M14 5h3v14h-3z'],
	prev: ['M18 5 9 12l9 7z', 'M6 5v14'],
	next: ['M6 5l9 7-9 7z', 'M18 5v14'],
	// Two lanes that cross, each ending in an arrowhead.
	shuffle: ['M3 7h4l10 10h4', 'M3 17h4l10-10h4', 'M18 4l3 3-3 3', 'M18 14l3 3-3 3'],
	repeat: [
		'M4 11V9a3 3 0 0 1 3-3h13',
		'M17 3l3 3-3 3',
		'M20 13v2a3 3 0 0 1-3 3H4',
		'M7 21l-3-3 3-3'
	],
	// `repeat` with a small 1 in its middle — a second glyph rather than a badge,
	// because the state has to read at 16 px with no colour (doc 12 §4.2).
	'repeat-one': [
		'M4 11V9a3 3 0 0 1 3-3h13',
		'M17 3l3 3-3 3',
		'M20 13v2a3 3 0 0 1-3 3H4',
		'M7 21l-3-3 3-3',
		'M11 10.5l1.2-.8v4.6'
	],
	volume: ['M4 9h3l5-4v14l-5-4H4z', 'M16 9a4 4 0 0 1 0 6', 'M19 6a8 8 0 0 1 0 12'],
	mute: ['M4 9h3l5-4v14l-5-4H4z', 'M16 9l5 6', 'M21 9l-5 6'],
	folder: [
		'M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z'
	],
	upload: ['M12 15V4', 'M8 8l4-4 4 4', 'M4 15v4h16v-4'],
	plus: ['M12 5v14', 'M5 12h14'],
	close: ['M6 6l12 12', 'M18 6L6 18'],
	expand: ['M14 4h6v6', 'M20 4l-7 7', 'M10 20H4v-6', 'M4 20l7-7'],
	settings: [
		'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
		'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 13.9H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 2.7-1.1V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3Z'
	],
	trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14', 'M10 11v6', 'M14 11v6'],
	search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'M21 21l-4.3-4.3'],
	locate: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3'],
	edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
};
