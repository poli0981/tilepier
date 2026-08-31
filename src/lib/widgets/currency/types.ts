/**
 * The currency tile's settings, as they sit in `tp.layout.v1[].settings`
 * (doc 05 §2) — never in Dexie, and never a schema on the manifest.
 */
export interface TpCurrencySettings {
	/** ISO 4217, uppercase. The amount is denominated in this. */
	base: string;
	/** ISO 4217, uppercase. The hero number is denominated in this. */
	quote: string;
	amount: number;
}

/** doc 08 §2: "default USD→VND", which is also doc 01's second target reader. */
export const CURRENCY_DEFAULTS: TpCurrencySettings = {
	base: 'USD',
	quote: 'VND',
	amount: 1
};

/**
 * An amount the tile is willing to render.
 *
 * Not a validation of what a reader may want to convert — it is a bound on
 * what a hand-edited `tp.layout.v1` can make the tile draw. Past this the
 * formatted hero runs to twenty digits and the tile has no honest layout.
 */
export const MAX_AMOUNT = 1e12;
