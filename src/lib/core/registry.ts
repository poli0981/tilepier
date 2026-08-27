import type { Component } from 'svelte';
import type { TpIconName } from '$lib/ui/icons/names';
import clock from '$lib/widgets/clock/manifest';
import notes from '$lib/widgets/notes/manifest';
import calc from '$lib/widgets/calc/manifest';
import timer from '$lib/widgets/timer/manifest';
import {
	CATEGORY_ORDER,
	type TpDetailProps,
	type TpWidgetCategory,
	type TpWidgetId,
	type TpWidgetProps,
	type TpWidgetSize
} from './types';

/**
 * The widget registry (doc 06 §1).
 *
 * This module statically imports every manifest, so it must stay cheap: a
 * manifest is object literals plus two `() => import()` thunks and nothing
 * else. That is what keeps the manifest index in the entry chunk while the
 * components ship as per-widget chunks.
 */

/**
 * doc 06 §1. Was `{ everyMs: number }`, which could not express two rows of
 * doc 06 §7's own table — `midnight` (calendar, quote) and visible-only
 * (markets).
 */
export type TpRefresh =
	| { kind: 'interval'; everyMs: number; visibleOnly?: boolean }
	| { kind: 'midnight' }
	| { kind: 'manual' };

export interface TpWidgetManifest {
	id: TpWidgetId;
	/** Namespace root, not a message. `<i18nKey>.title` and `.blurb` are
	 *  required and checked by `pnpm i18n:check` (doc 06 §1). */
	i18nKey: `widget.${TpWidgetId}`;
	category: TpWidgetCategory;
	icon: TpIconName;
	sizes: { min: TpWidgetSize; max: TpWidgetSize; default: TpWidgetSize };
	multiInstance: boolean;
	refresh?: TpRefresh;
	permissions?: readonly ('geolocation' | 'notifications' | 'fsa')[];
	loadWidget: () => Promise<{ default: Component<TpWidgetProps> }>;
	loadDetail?: () => Promise<{ default: Component<TpDetailProps> }>;
}

/**
 * Grows a row per widget as each lands (doc 23) — `clock` in Week 1, the four
 * tier-1 widgets through Week 2. `core/registry.test.ts` checks each *registered* manifest
 * against its row in doc 06 §7, so the table stays authoritative without
 * failing on widgets that do not exist yet.
 */
export const MANIFESTS: readonly TpWidgetManifest[] = [clock, timer, calc, notes];

const BY_ID = new Map<string, TpWidgetManifest>(MANIFESTS.map((m) => [m.id, m]));

export function getManifest(id: string): TpWidgetManifest | undefined {
	return BY_ID.get(id);
}

/** Drawer grouping (doc 13 §4). Empty categories are dropped rather than
 *  rendered as bare headings. */
export function listByCategory(): readonly {
	category: TpWidgetCategory;
	items: readonly TpWidgetManifest[];
}[] {
	return CATEGORY_ORDER.map((category) => ({
		category,
		items: MANIFESTS.filter((m) => m.category === category)
	})).filter((group) => group.items.length > 0);
}

/** doc 06 §4: a single-instance widget already on the deck shows as "on deck"
 *  and disabled, rather than silently doing nothing when clicked. */
export function isOnDeck(id: TpWidgetId, widgetIds: readonly string[]): boolean {
	const manifest = getManifest(id);
	if (manifest === undefined || manifest.multiInstance) return false;
	return widgetIds.includes(id);
}
