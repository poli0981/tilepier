/**
 * The map's types, beside `TpMap.svelte` rather than in its module script: a
 * `.svelte` file's named exports are invisible to plain `tsc`, which knows
 * Svelte files only as a default export (`declare module '*.svelte'`), and the
 * TypeScript 7 check reads these files that way (doc 02).
 */

/** What the map is doing, for the widget to render around it. */
export type TpMapStatus = 'loading' | 'ready' | 'offline' | 'error' | 'no-webgl';

/** A point to mark. The label is text — a geocoder's name is a stranger's
 *  string, and it goes into an attribute, never into HTML (rule 7). */
export interface TpMapPin {
	id: string;
	lat: number;
	lon: number;
	kind: 'home' | 'saved' | 'found';
	label: string;
}

/** What a detail can ask of the map it is showing. */
export interface TpMapCamera {
	flyTo(lat: number, lon: number, zoom?: number): void;
}
