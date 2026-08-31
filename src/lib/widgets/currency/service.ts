import type { TpApiMeta, TpFxPayload } from '$lib/api-types';
import { fetchEnvelope } from '$lib/core/api';
import { swr, type TpSwrFetcher, type TpSwrHandle } from '$lib/core/swr.svelte';
import type { TpDb } from '$lib/core/storage/db';
import { CACHE_POLICY, cacheKey } from '$lib/shared-constants';
import { CURRENCY_DEFAULTS, MAX_AMOUNT, MAX_TARGETS, type TpCurrencySettings } from './types';

/**
 * The currency tile's data layer — the tier-2 pattern's second proof, and the
 * first place it is reused rather than invented.
 *
 * Pure but for `fxSource`, so every decision the tile makes is testable in the
 * node project without a DOM.
 */

/**
 * What the tile subscribes to.
 *
 * `T` carries the envelope's `meta` for the reason `weather/service.ts` spells
 * out at length: `swr` computes staleness from the *client's* cache age alone,
 * so a table the Worker served past its KV TTL because ER-API was down arrives
 * with a fresh `cachedAt` and would read as `fresh`. A day-old rate presented
 * as today's is the whole failure mode this widget has.
 */
export interface TpFxReading {
	payload: TpFxPayload;
	meta: TpApiMeta;
}

/* ─────────────────────────────────────────────────────────────── the source */

/**
 * The data key, spelled the way the Worker spells it (doc 04 §5).
 *
 * **It does not depend on the pair**, and that is the endpoint's design showing
 * through: one cached USD table answers every pair, and the division happens
 * here. So unlike weather, a settings change never moves this key — which is
 * why the tile needs no `{#key}` remount dance around its subscription. Said
 * out loud because the next reader will arrive expecting weather's shape.
 */
export function fxKey(): string {
	return cacheKey.fx();
}

/** doc 11 §3 gives this route no parameters at all. */
export function fxUrl(): string {
	return '/api/fx';
}

/** Not exported: `fxSource` is the only caller, and knip is CI-blocking on an
 *  export nothing imports. */
function fetchFx(): TpSwrFetcher<TpFxReading> {
	return async (signal) => {
		const result = await fetchEnvelope<TpFxPayload>(fxUrl(), signal);
		return { payload: result.data, meta: result.meta };
	};
}

/**
 * Subscribe to the rate table.
 *
 * `target` is threaded through so a component test can drive a throwaway Dexie
 * rather than the reader's own, the way `weather/service.ts` does.
 */
export function fxSource(target?: TpDb): TpSwrHandle<TpFxReading> {
	// doc 08 §2's "12 h client ttl" is the same number as the Worker's KV TTL,
	// which is the floor doc 04 §2 requires: a shorter client window would
	// revalidate into a guaranteed HIT.
	const options = { ttlMs: CACHE_POLICY.fx.ttlMs };

	return target === undefined
		? swr<TpFxReading>(fxKey(), fetchFx(), options)
		: swr<TpFxReading>(fxKey(), fetchFx(), options, target);
}

/* ──────────────────────────────────────────────────────────────── settings */

/** ISO 4217, and the same shape the Worker keeps in a rate table. */
const CURRENCY_CODE = /^[A-Z]{3}$/;

/** Not exported: callers reach it through `readSettings`, and knip is
 *  CI-blocking on an export nothing imports. */
function readCode(value: unknown, fallback: string): string {
	if (typeof value !== 'string') return fallback;
	const code = value.trim().toUpperCase();
	return CURRENCY_CODE.test(code) ? code : fallback;
}

/**
 * Fail-closed, in the style of `weather/service.ts` and `quote/service.ts`: a
 * settings bag hand-edited into the layout, or written by an older build, must
 * land on a working USD→VND tile rather than take the tile down.
 *
 * A code that passes this and is still absent from the rate table is a
 * different thing — doc 08 §2's "upstream dropped it" edge case — and is the
 * tile's business rather than this function's. Shape is checked here;
 * availability is checked against the payload.
 */
export function readSettings(bag: Record<string, unknown>): TpCurrencySettings {
	const amount = bag['amount'];

	return {
		base: readCode(bag['base'], CURRENCY_DEFAULTS.base),
		quote: readCode(bag['quote'], CURRENCY_DEFAULTS.quote),
		amount:
			typeof amount === 'number' && Number.isFinite(amount) && amount >= 0 && amount <= MAX_AMOUNT
				? amount
				: CURRENCY_DEFAULTS.amount,
		targets: readTargets(bag['targets'])
	};
}

/**
 * The detail's rows, deduped and bounded.
 *
 * An empty list is a legitimate answer — a reader can remove every row — so a
 * bag carrying `[]` keeps it, and only a bag carrying something that is not a
 * list at all falls back to the defaults.
 */
function readTargets(value: unknown): string[] {
	if (!Array.isArray(value)) return [...CURRENCY_DEFAULTS.targets];

	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== 'string') continue;
		const code = entry.trim().toUpperCase();
		if (CURRENCY_CODE.test(code)) seen.add(code);
		if (seen.size >= MAX_TARGETS) break;
	}
	return [...seen];
}

/* ──────────────────────────────────────────────────────────────── the maths */

/**
 * One rate out of one USD-based table.
 *
 * `null` rather than `NaN` for a code the table does not carry, because the
 * tile has something to *say* about that (doc 08 §2: keep the row, mark it
 * unavailable) and nothing to say about a `NaN`.
 *
 * Zero and negative rates are refused for the same reason `normalize.ts`
 * refuses to store them: the division below would turn one into an `Infinity`
 * on screen rather than into an obviously wrong number.
 */
function crossRate(table: Record<string, number> | null, from: string, to: string): number | null {
	if (from === to) return 1;
	if (table === null) return null;

	const base = table[from];
	const quote = table[to];
	if (typeof base !== 'number' || !Number.isFinite(base) || base <= 0) return null;
	if (typeof quote !== 'number' || !Number.isFinite(quote)) return null;

	return quote / base;
}

export function rateFor(payload: TpFxPayload, from: string, to: string): number | null {
	return crossRate(payload.rates, from, to);
}

export function convert(
	payload: TpFxPayload,
	amount: number,
	from: string,
	to: string
): number | null {
	const rate = rateFor(payload, from, to);
	return rate === null ? null : amount * rate;
}

/**
 * doc 08 §2's 24 h change, as a *fraction* — 0.0021, not 0.21.
 *
 * A fraction because `Intl.NumberFormat`'s `style: 'percent'` wants one, and
 * letting it place the sign and the symbol is the difference between "+0,21 %"
 * in Vietnamese and a hand-built string that is right in exactly one locale.
 *
 * `null` whenever there is nothing honest to say: on the day this ships there
 * is no previous snapshot at all, and a pair can be missing from yesterday's
 * table even when it is in today's. The caller renders **no change** in that
 * case rather than a zero — a 0.00 % is a claim about the market, and an absent
 * figure is the truth about what we know.
 */
export function change24h(payload: TpFxPayload, from: string, to: string): number | null {
	const now = crossRate(payload.rates, from, to);
	const before = crossRate(payload.prevRates, from, to);
	if (now === null || before === null || before === 0) return null;

	return (now - before) / before;
}

/**
 * Every code the table can convert, sorted, for the pair pickers.
 *
 * Codes the reader has stored are folded in even when upstream dropped them, so
 * the picker still shows the pair the tile is actually set to. Selecting an
 * unavailable code is how a reader gets *out* of that state, and a picker that
 * hid it would leave them stuck on a row they cannot change.
 */
export function currencyCodes(payload: TpFxPayload | undefined, ...stored: string[]): string[] {
	const codes = new Set<string>(payload === undefined ? [] : Object.keys(payload.rates));
	for (const code of stored) if (CURRENCY_CODE.test(code)) codes.add(code);

	return [...codes].sort();
}
