/** doc 07 §7 — three tools in one widget (charter decision 2026-07-19). */

export type TpToolboxTab = 'qr' | 'password' | 'color';

export const TOOLBOX_TABS: readonly TpToolboxTab[] = ['qr', 'password', 'color'];

/** doc 07 §7: "Recent colors kept in the tile `settings` (max 8)". */
export const RECENT_COLORS_MAX = 8;

/**
 * Per-instance settings (doc 05 §2).
 *
 * Two fields, and doc 07 §7 names both: which tab the tile shows, and the
 * recent colours. Everything else the panels hold — the QR text, the error
 * correction level, the password options, the password itself — is session
 * state. A half-typed URL is not a preference, and a generated password is the
 * one thing that section says must never be stored anywhere; keeping the
 * options beside it and the value out would be an invitation to add the value
 * later "for convenience".
 */
export interface TpToolboxSettings {
	tab: TpToolboxTab;
	recentColors: readonly string[];
}

export function isToolboxTab(value: unknown): value is TpToolboxTab {
	return typeof value === 'string' && (TOOLBOX_TABS as readonly string[]).includes(value);
}
