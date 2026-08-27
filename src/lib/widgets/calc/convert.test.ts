import { describe, expect, it } from 'vitest';
import { CATEGORIES, convert, unitsFor, type TpUnitCategory } from './convert';
import { fromString, toPlainString } from './decimal';

/**
 * doc 19 §3.2 singles out "affine temperature" as a non-negotiable case, and
 * it is the right one to single out: every other category is a single
 * multiplication, and temperature is the one that has an offset to get
 * backwards.
 */

function to(value: string, from: string, unit: string, category: TpUnitCategory): string {
	const parsed = fromString(value);
	if (parsed === null) throw new Error(`"${value}" is not a decimal`);

	const outcome = convert(parsed, from, unit, category);
	if (!outcome.ok) throw new Error(`expected a value, got ${outcome.error}`);
	return toPlainString(outcome.value);
}

describe('temperature — the affine case', () => {
	it('converts the fixed points exactly', () => {
		expect(to('0', '°C', '°F', 'temperature')).toBe('32');
		expect(to('100', '°C', '°F', 'temperature')).toBe('212');
		expect(to('32', '°F', '°C', 'temperature')).toBe('0');
		expect(to('212', '°F', '°C', 'temperature')).toBe('100');
	});

	it('crosses zero without losing the offset', () => {
		// The sign is where an affine conversion written as a bare factor breaks.
		expect(to('-40', '°C', '°F', 'temperature')).toBe('-40');
		expect(to('-40', '°F', '°C', 'temperature')).toBe('-40');
		expect(to('-17.78', '°C', '°F', 'temperature')).toBe('-0.004');
	});

	it('handles Kelvin, which has an offset but no scale', () => {
		expect(to('0', '°C', 'K', 'temperature')).toBe('273.15');
		expect(to('273.15', 'K', '°C', 'temperature')).toBe('0');
		expect(to('0', 'K', '°C', 'temperature')).toBe('-273.15');
	});

	it('goes between the two units that both differ from the base', () => {
		// °F → °C → K, which is where a composed conversion drops a term.
		expect(to('32', '°F', 'K', 'temperature')).toBe('273.15');
		expect(to('373.15', 'K', '°F', 'temperature')).toBe('212');
	});

	it('rounds a repeating conversion rather than drifting', () => {
		// 100 °F is 37.77… °C; twelve digits and no float residue.
		expect(to('100', '°F', '°C', 'temperature')).toBe('37.7777777778');
	});

	it('is identity for the same unit', () => {
		expect(to('21.5', '°C', '°C', 'temperature')).toBe('21.5');
	});
});

describe('length', () => {
	it('converts within the metric ladder exactly', () => {
		expect(to('1', 'km', 'm', 'length')).toBe('1000');
		expect(to('2500', 'mm', 'm', 'length')).toBe('2.5');
		expect(to('1', 'm', 'cm', 'length')).toBe('100');
	});

	it('uses the exact definitions of the imperial units', () => {
		// A foot is 0.3048 m by international agreement, not approximately.
		expect(to('1', 'ft', 'm', 'length')).toBe('0.3048');
		expect(to('1', 'in', 'cm', 'length')).toBe('2.54');
		expect(to('1', 'mi', 'km', 'length')).toBe('1.609344');
		expect(to('1', 'yd', 'ft', 'length')).toBe('3');
	});

	it('round-trips back to where it started', () => {
		expect(to(to('1', 'mi', 'm', 'length'), 'm', 'mi', 'length')).toBe('1');
	});
});

describe('the other factor categories', () => {
	it('converts mass on exact definitions', () => {
		expect(to('1', 'kg', 'g', 'mass')).toBe('1000');
		expect(to('1', 'lb', 'g', 'mass')).toBe('453.59237');
		expect(to('16', 'oz', 'lb', 'mass')).toBe('1');
	});

	it('reads data in binary multiples, the way a file manager does', () => {
		expect(to('1', 'KB', 'B', 'data')).toBe('1024');
		expect(to('1', 'GB', 'MB', 'data')).toBe('1024');
		expect(to('1024', 'B', 'KB', 'data')).toBe('1');
	});

	it('converts speed without a repeating factor', () => {
		// The reason km/h is the base rather than m/s: this is exact both ways,
		// where m/s per km/h is five eighteenths and is not.
		expect(to('1', 'm/s', 'km/h', 'speed')).toBe('3.6');
		expect(to('3.6', 'km/h', 'm/s', 'speed')).toBe('1');
		expect(to('1', 'kn', 'km/h', 'speed')).toBe('1.852');
	});

	it('converts area, volume and time', () => {
		expect(to('1', 'ha', 'm²', 'area')).toBe('10000');
		expect(to('1', 'm³', 'l', 'volume')).toBe('1000');
		expect(to('1', 'h', 'min', 'time')).toBe('60');
		expect(to('1', 'd', 'h', 'time')).toBe('24');
		expect(to('1', 'wk', 'd', 'time')).toBe('7');
	});
});

describe('the table itself', () => {
	it('offers every documented category', () => {
		// doc 07 §3: length/mass/temp/data/area/volume/speed/time.
		expect([...CATEGORIES]).toEqual([
			'length',
			'mass',
			'temperature',
			'data',
			'area',
			'volume',
			'speed',
			'time'
		]);
	});

	it('gives every category at least two units to convert between', () => {
		for (const category of CATEGORIES) {
			expect(unitsFor(category).length, category).toBeGreaterThanOrEqual(2);
		}
	});

	it('round-trips every unit against the first one in its category', () => {
		// A factor with a typo in it usually survives one direction and not both.
		//
		// Compared to twelve significant digits rather than exactly: the trip out
		// rounds to the cap, and a value that ends up far from 1 — millimetres in
		// miles is 7.767e-6 — cannot then return the last digit it never carried.
		// Exact equality here would be asserting more precision than doc 07 §3
		// promises.
		for (const category of CATEGORIES) {
			const units = unitsFor(category);
			const base = units[0] as string;

			for (const unit of units) {
				const there = to('12.5', base, unit, category);
				const back = Number(to(there, unit, base, category));
				expect(back, `${category}: ${base} ⇄ ${unit}`).toBeCloseTo(12.5, 10);
			}
		}
	});

	it('reports a unit it does not know rather than guessing', () => {
		const parsed = fromString('1');
		const outcome = convert(parsed!, 'furlong', 'm', 'length');
		expect(outcome.ok ? 'ok' : outcome.error).toBe('SYNTAX');
	});
});
