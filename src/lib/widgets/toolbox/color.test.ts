import { describe, expect, it } from 'vitest';
import {
	contrastRatio,
	contrastVerdict,
	hslToRgb,
	parseHex,
	ramp,
	relativeLuminance,
	rgbToHsl,
	toHex,
	toHslString,
	toRgbString,
	type TpRgb
} from './color';

/**
 * doc 07 §7's colour tab.
 *
 * The contrast figures are checked against **the design tokens themselves**,
 * not against this module's own output. doc 13 §8 states the ratio of two token
 * pairs as fact and doc 13 §8's Week 8 audit rests on them, so if the ramp and
 * the doc ever disagree CI should say so — which is exactly what happened the
 * first time this ran.
 */

const BLACK: TpRgb = { r: 0, g: 0, b: 0 };

describe('parseHex', () => {
	it('reads six digits, with or without the hash', () => {
		expect(parseHex('#46D5C8')).toEqual({ r: 0x46, g: 0xd5, b: 0xc8 });
		expect(parseHex('46d5c8')).toEqual({ r: 0x46, g: 0xd5, b: 0xc8 });
	});

	it('expands the three-digit form', () => {
		expect(parseHex('#0f8')).toEqual({ r: 0x00, g: 0xff, b: 0x88 });
	});

	it('tolerates surrounding space and either case', () => {
		expect(parseHex('  #FFF  ')).toEqual({ r: 255, g: 255, b: 255 });
	});

	it('returns null for a half-typed value rather than guessing', () => {
		// An input is half-typed most of the time it is being used.
		for (const bad of ['', '#', '#12', '#1234', '#12345', 'nope', '#gggggg', '#1234567']) {
			expect(parseHex(bad), bad).toBeNull();
		}
	});
});

describe('formatting', () => {
	it('round-trips hex', () => {
		expect(toHex({ r: 0x46, g: 0xd5, b: 0xc8 })).toBe('#46d5c8');
		expect(toHex(parseHex('#46d5c8') ?? { r: 0, g: 0, b: 0 })).toBe('#46d5c8');
	});

	it('clamps rather than emitting a hex that is not one', () => {
		expect(toHex({ r: -20, g: 300, b: 128 })).toBe('#00ff80');
	});

	it('writes the modern space-separated rgb and hsl forms', () => {
		expect(toRgbString({ r: 70, g: 213, b: 200 })).toBe('rgb(70 213 200)');
		expect(toHslString({ h: 174, s: 62, l: 55 })).toBe('hsl(174 62% 55%)');
	});
});

describe('hsl round trip', () => {
	it('reproduces the greys, where hue is undefined', () => {
		expect(rgbToHsl({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, l: 0 });
		expect(rgbToHsl({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, l: 100 });
		expect(rgbToHsl({ r: 128, g: 128, b: 128 })).toMatchObject({ s: 0 });
	});

	it('puts the primaries on the hue circle where they belong', () => {
		expect(rgbToHsl({ r: 255, g: 0, b: 0 })).toMatchObject({ h: 0, s: 100, l: 50 });
		expect(rgbToHsl({ r: 0, g: 255, b: 0 })).toMatchObject({ h: 120, s: 100, l: 50 });
		expect(rgbToHsl({ r: 0, g: 0, b: 255 })).toMatchObject({ h: 240, s: 100, l: 50 });
	});

	it('comes back to within a rounding step', () => {
		// Both directions round to integers, so exact equality is not the claim.
		for (const rgb of [
			{ r: 70, g: 213, b: 200 },
			{ r: 232, g: 112, b: 95 },
			{ r: 12, g: 34, b: 56 },
			{ r: 250, g: 250, b: 3 }
		]) {
			const back = hslToRgb(rgbToHsl(rgb));
			expect(Math.abs(back.r - rgb.r), `r of ${toHex(rgb)}`).toBeLessThanOrEqual(3);
			expect(Math.abs(back.g - rgb.g), `g of ${toHex(rgb)}`).toBeLessThanOrEqual(3);
			expect(Math.abs(back.b - rgb.b), `b of ${toHex(rgb)}`).toBeLessThanOrEqual(3);
		}
	});

	it('normalises a hue outside the circle instead of indexing off the end', () => {
		expect(hslToRgb({ h: 480, s: 100, l: 50 })).toEqual(hslToRgb({ h: 120, s: 100, l: 50 }));
		expect(hslToRgb({ h: -60, s: 100, l: 50 })).toEqual(hslToRgb({ h: 300, s: 100, l: 50 }));
	});
});

describe('relativeLuminance', () => {
	it('anchors at the ends of the scale', () => {
		expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
		expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 6);
	});

	it('weights green far above blue, which is what the coefficients are for', () => {
		const green = relativeLuminance({ r: 0, g: 255, b: 0 });
		const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
		expect(green).toBeCloseTo(0.7152, 4);
		expect(blue).toBeCloseTo(0.0722, 4);
	});

	it('uses the linear segment below the sRGB kink', () => {
		// 10/255 is under 0.03928, so it divides by 12.92 rather than taking the
		// 2.4 power — the branch that is wrong in every naive implementation.
		expect(relativeLuminance({ r: 10, g: 10, b: 10 })).toBeCloseTo(10 / 255 / 12.92, 6);
	});
});

describe('contrastRatio', () => {
	it('spans 1 to 21', () => {
		expect(contrastRatio({ r: 0, g: 0, b: 0 }, { r: 255, g: 255, b: 255 })).toBeCloseTo(21, 2);
		expect(contrastRatio({ r: 70, g: 213, b: 200 }, { r: 70, g: 213, b: 200 })).toBeCloseTo(1, 6);
	});

	it('does not care which colour is given first', () => {
		const a = { r: 222, g: 231, b: 238 };
		const b = { r: 11, g: 15, b: 20 };
		expect(contrastRatio(a, b)).toBeCloseTo(contrastRatio(b, a), 10);
	});

	it('agrees with the figures doc 13 §8 states for the token pairs', () => {
		// doc 13 §8 asserted 11.9 and 5.1 before anything had computed them.
		// Measured here on 2026-08-28 they are 15.35 and 7.16 — both better than
		// claimed, both still wrong as written, and both now checked against the
		// tokens so the doc and the ramp cannot drift apart again. Cross-checked
		// against a second implementation written from the WCAG 2.1 text, which
		// agreed to ten places.
		const ink900 = { r: 0x0b, g: 0x0f, b: 0x14 };
		expect(parseHex('#0B0F14')).toEqual(ink900);

		const fg = parseHex('#DEE7EE');
		const fgMute = parseHex('#8FA0B0');
		const fgDim = parseHex('#5C6B7A');
		expect(fg).not.toBeNull();
		expect(fgMute).not.toBeNull();
		expect(fgDim).not.toBeNull();

		expect(contrastRatio(fg as TpRgb, ink900)).toBeCloseTo(15.35, 2);
		expect(contrastVerdict(contrastRatio(fg as TpRgb, ink900))).toBe('AAA');

		expect(contrastRatio(fgMute as TpRgb, ink900)).toBeCloseTo(7.16, 2);
		expect(contrastVerdict(contrastRatio(fgMute as TpRgb, ink900))).toBe('AAA');

		// The finding doc 13 §8 now records for the Week 8 audit: `fg-dim` is a
		// large-text pass and a normal-text failure, and it is used at
		// `--text-2xs` in three widgets.
		expect(contrastRatio(fgDim as TpRgb, ink900)).toBeCloseTo(3.51, 2);
		expect(contrastVerdict(contrastRatio(fgDim as TpRgb, ink900))).toBe('AA-large');
	});
});

describe('contrastVerdict', () => {
	it('reads the WCAG 2.1 thresholds off the ratio', () => {
		expect(contrastVerdict(21)).toBe('AAA');
		expect(contrastVerdict(7)).toBe('AAA');
		expect(contrastVerdict(6.99)).toBe('AA');
		expect(contrastVerdict(4.5)).toBe('AA');
		expect(contrastVerdict(4.49)).toBe('AA-large');
		expect(contrastVerdict(3)).toBe('AA-large');
		expect(contrastVerdict(2.99)).toBe('fail');
		expect(contrastVerdict(1)).toBe('fail');
	});

	it('names large-text AA rather than folding it into a failure', () => {
		// doc 13 §3's hero numerals are large text, so 3:1 is a pass for them
		// and calling it "fail" would send an audit chasing a non-problem.
		expect(contrastVerdict(3.5)).toBe('AA-large');
	});
});

describe('ramp', () => {
	it('has the colour itself in the middle', () => {
		const base = { r: 70, g: 213, b: 200 };
		const steps = ramp(base);
		expect(steps).toHaveLength(5);
		expect(steps[2]).toEqual(base);
	});

	it('runs light to dark', () => {
		const steps = ramp({ r: 70, g: 213, b: 200 }).map(relativeLuminance);
		for (let i = 1; i < steps.length; i++) {
			expect(steps[i], `step ${String(i)}`).toBeLessThan(steps[i - 1] as number);
		}
	});

	it('keeps the hue, which is why it interpolates in HSL', () => {
		// Mixing toward white in RGB desaturates as it lightens, so a ramp built
		// that way stops being a ramp *of* the colour at both ends.
		const base = { r: 70, g: 213, b: 200 };
		const hue = rgbToHsl(base).h;
		for (const step of ramp(base)) {
			expect(Math.abs(rgbToHsl(step).h - hue)).toBeLessThanOrEqual(2);
		}
	});

	it('reaches neither pure white nor pure black', () => {
		// Both ends of every ramp would otherwise be the same colour.
		const steps = ramp({ r: 70, g: 213, b: 200 });
		expect(toHex(steps[0] ?? BLACK)).not.toBe('#ffffff');
		expect(toHex(steps[4] ?? BLACK)).not.toBe('#000000');
	});

	it('leaves a grey grey', () => {
		for (const step of ramp({ r: 128, g: 128, b: 128 })) {
			expect(rgbToHsl(step).s).toBe(0);
		}
	});
});
