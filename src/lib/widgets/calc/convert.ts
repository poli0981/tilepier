import { add, divide, fromString, multiply, subtract, type TpDecimal } from './decimal';
import type { TpCalcResult } from './engine';

/**
 * doc 07 §3's converter: "categories length/mass/temp/data/area/volume/speed/
 * time. Conversion factors are a static table; temperature is the only affine
 * case — unit test it."
 *
 * **Every factor below is an exact decimal**, which is not luck — it is what
 * the choice of base unit buys. Speed is based on km/h rather than the more
 * obvious m/s precisely for this: m/s per km/h is 5/18, which no decimal can
 * hold, while km/h per m/s is exactly 3.6. Same for the imperial lengths,
 * which are *defined* as exact decimals of a metre (a foot is 0.3048 m by
 * international agreement, not approximately). So a conversion rounds once, at
 * the division, and never accumulates.
 *
 * Temperature does not fit the table and is not made to. It has its own pair
 * of affine functions, with exact constants of its own.
 */

export type TpUnitCategory =
	'length' | 'mass' | 'temperature' | 'data' | 'area' | 'volume' | 'speed' | 'time';

export const CATEGORIES: readonly TpUnitCategory[] = [
	'length',
	'mass',
	'temperature',
	'data',
	'area',
	'volume',
	'speed',
	'time'
];

/** Parses a factor written as a literal above. A malformed one is a bug in
 *  this file, not in user input, so it fails loudly at module load. */
function factor(text: string): TpDecimal {
	const value = fromString(text);
	if (value === null) throw new Error(`conversion factor "${text}" is not a decimal`);
	return value;
}

/** Base units per one of this unit. The base is whichever unit has factor 1. */
const FACTORS: Record<Exclude<TpUnitCategory, 'temperature'>, Record<string, TpDecimal>> = {
	// base: metre
	length: {
		mm: factor('0.001'),
		cm: factor('0.01'),
		m: factor('1'),
		km: factor('1000'),
		in: factor('0.0254'),
		ft: factor('0.3048'),
		yd: factor('0.9144'),
		mi: factor('1609.344')
	},
	// base: gram
	mass: {
		mg: factor('0.001'),
		g: factor('1'),
		kg: factor('1000'),
		t: factor('1000000'),
		oz: factor('28.349523125'),
		lb: factor('453.59237')
	},
	// base: byte. Binary multiples, which is what a file manager means.
	data: {
		B: factor('1'),
		KB: factor('1024'),
		MB: factor('1048576'),
		GB: factor('1073741824'),
		TB: factor('1099511627776')
	},
	// base: square metre
	area: {
		'cm²': factor('0.0001'),
		'm²': factor('1'),
		ha: factor('10000'),
		'km²': factor('1000000'),
		'ft²': factor('0.09290304'),
		ac: factor('4046.8564224')
	},
	// base: litre
	volume: {
		ml: factor('0.001'),
		l: factor('1'),
		'm³': factor('1000'),
		'fl oz': factor('0.0295735295625'),
		cup: factor('0.2365882365'),
		gal: factor('3.785411784')
	},
	// base: km/h — see the note above; this is why.
	speed: {
		'km/h': factor('1'),
		'm/s': factor('3.6'),
		mph: factor('1.609344'),
		'ft/s': factor('1.09728'),
		kn: factor('1.852')
	},
	// base: second
	time: {
		ms: factor('0.001'),
		s: factor('1'),
		min: factor('60'),
		h: factor('3600'),
		d: factor('86400'),
		wk: factor('604800')
	}
};

/**
 * The affine case, stated as `°X = °C × scale + offset`.
 *
 * Written in this direction, not the inverse, because it is the direction with
 * exact constants: Fahrenheit is 1.8 and 32 exactly, where the way back is
 * five ninths and cannot be written down. The reverse is computed by dividing,
 * which rounds once, in the one place this module rounds at all.
 */
const TEMPERATURE: Record<string, { scale: TpDecimal; offset: TpDecimal }> = {
	'°C': { scale: factor('1'), offset: factor('0') },
	'°F': { scale: factor('1.8'), offset: factor('32') },
	K: { scale: factor('1'), offset: factor('273.15') }
};

export function unitsFor(category: TpUnitCategory): readonly string[] {
	return category === 'temperature' ? Object.keys(TEMPERATURE) : Object.keys(FACTORS[category]);
}

/**
 * Converts between two units of one category.
 *
 * Returns the same result shape as the expression engine, so the display has
 * one error path rather than two — a conversion cannot divide by zero given
 * the table above, but a unit this build does not know is a `SYNTAX` failure
 * in exactly the sense the caller already handles.
 */
export function convert(
	value: TpDecimal,
	from: string,
	to: string,
	category: TpUnitCategory
): TpCalcResult {
	if (from === to) return { ok: true, value };

	if (category === 'temperature') {
		const source = TEMPERATURE[from];
		const target = TEMPERATURE[to];
		if (source === undefined || target === undefined) return { ok: false, error: 'SYNTAX' };

		// To Celsius, then out again. Two affine steps rather than one composed
		// one, because composing them is where a sign or an offset goes missing.
		const celsius = divide(subtract(value, source.offset), source.scale);
		if (celsius === null) return { ok: false, error: 'SYNTAX' };

		return { ok: true, value: add(multiply(celsius, target.scale), target.offset) };
	}

	const table = FACTORS[category];
	const sourceFactor = table[from];
	const targetFactor = table[to];
	if (sourceFactor === undefined || targetFactor === undefined) {
		return { ok: false, error: 'SYNTAX' };
	}

	const inBase = multiply(value, sourceFactor);
	const result = divide(inBase, targetFactor);
	return result === null ? { ok: false, error: 'SYNTAX' } : { ok: true, value: result };
}
