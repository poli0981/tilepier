/**
 * Identity types shared across the registry, the deck and the widgets
 * (doc 06 §1). They live outside `registry.ts` so that a widget's `types.ts`
 * can name its own id without importing the module that imports every manifest.
 */

/** The v1 registry, doc 06 §7. The union is complete from the start even
 *  though the manifests land one per week — it is what makes a stored layout
 *  referring to a not-yet-built widget a type error rather than a surprise. */
export type TpWidgetId =
	| 'clock'
	| 'timer'
	| 'calc'
	| 'notes'
	| 'todo'
	| 'calendar'
	| 'toolbox'
	| 'weather'
	| 'currency'
	| 'quote'
	| 'rss'
	| 'map'
	| 'markets'
	| 'music'
	| 'media';

export type TpWidgetCategory = 'time' | 'productivity' | 'finance' | 'info' | 'media' | 'tools';

/** Drawer grouping order (doc 13 §4). Not alphabetical: it runs from what a
 *  person reaches for daily to what they configure once. */
export const CATEGORY_ORDER: readonly TpWidgetCategory[] = [
	'time',
	'productivity',
	'info',
	'finance',
	'media',
	'tools'
];

const WIDGET_IDS: readonly string[] = [
	'clock',
	'timer',
	'calc',
	'notes',
	'todo',
	'calendar',
	'toolbox',
	'weather',
	'currency',
	'quote',
	'rss',
	'map',
	'markets',
	'music',
	'media'
];

/** Guards a string read out of storage (doc 05 §5's unknown-widgetId case). */
export function isWidgetId(value: unknown): value is TpWidgetId {
	return typeof value === 'string' && WIDGET_IDS.includes(value);
}

/** Grid units, not pixels — gridstack columns and rows (doc 06 §5.4). */
export interface TpWidgetSize {
	w: number;
	h: number;
}

/** What the host measures and passes down; widgets never read the DOM for it
 *  (doc 06 §2). `pxW`/`pxH` are the content box, not the tile. */
export interface TpTileSize extends TpWidgetSize {
	pxW: number;
	pxH: number;
	/** Density tier from doc 13 §3, computed once by the host. */
	tier: 'S' | 'M' | 'L';
}

/** Props every `Tp<Name>Widget.svelte` receives (doc 06 §2). */
export interface TpWidgetProps {
	instanceId: string;
	settings: Record<string, unknown>;
	size: TpTileSize;
	onOpenDetail?: (() => void) | undefined;
	onUpdateSettings?: ((partial: Record<string, unknown>) => void) | undefined;
}
