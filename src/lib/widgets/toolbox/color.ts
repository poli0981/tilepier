/**
 * Colour maths for doc 07 §7's third tab: parsing, the WCAG contrast check,
 * and the tint/shade ramp.
 *
 * The contrast half is not only the widget's. doc 13 §8 puts a contrast audit
 * of every semantic-on-surface pair in Week 8, and doc 12 §4 already asserts
 * figures for two of them — so this is where that audit gets its arithmetic,
 * and it is written to be reusable rather than to serve one panel.
 *
 * sRGB throughout, which is what `#rrggbb` means and what WCAG 2.1 defines its
 * relative luminance over.
 */

export interface TpRgb {
	r: number;
	g: number;
	b: number;
}

export interface TpHsl {
	h: number;
	s: number;
	l: number;
}

/* ─────────────────────────────────────────────────────────────── parsing */

/**
 * `#rgb`, `#rrggbb`, with or without the hash. `null` for anything else — a
 * half-typed hex is a normal state of an input, not an error to shout about.
 */
export function parseHex(value: string): TpRgb | null {
	const raw = value.trim().replace(/^#/, '');
	if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(raw)) return null;

	const full =
		raw.length === 3
			? [...raw].map((character) => character + character).join('')
			: raw.toLowerCase();

	return {
		r: Number.parseInt(full.slice(0, 2), 16),
		g: Number.parseInt(full.slice(2, 4), 16),
		b: Number.parseInt(full.slice(4, 6), 16)
	};
}

const byte = (value: number): string =>
	Math.max(0, Math.min(255, Math.round(value)))
		.toString(16)
		.padStart(2, '0');

export function toHex(rgb: TpRgb): string {
	return `#${byte(rgb.r)}${byte(rgb.g)}${byte(rgb.b)}`;
}

export function toRgbString(rgb: TpRgb): string {
	return `rgb(${String(Math.round(rgb.r))} ${String(Math.round(rgb.g))} ${String(Math.round(rgb.b))})`;
}

export function rgbToHsl(rgb: TpRgb): TpHsl {
	const r = rgb.r / 255;
	const g = rgb.g / 255;
	const b = rgb.b / 255;

	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const delta = max - min;
	const l = (max + min) / 2;

	if (delta === 0) return { h: 0, s: 0, l: Math.round(l * 100) };

	const s = delta / (1 - Math.abs(2 * l - 1));
	let h: number;
	if (max === r) h = ((g - b) / delta) % 6;
	else if (max === g) h = (b - r) / delta + 2;
	else h = (r - g) / delta + 4;

	return {
		h: Math.round((((h * 60) % 360) + 360) % 360),
		s: Math.round(s * 100),
		l: Math.round(l * 100)
	};
}

export function hslToRgb(hsl: TpHsl): TpRgb {
	const h = ((hsl.h % 360) + 360) % 360;
	const s = Math.max(0, Math.min(100, hsl.s)) / 100;
	const l = Math.max(0, Math.min(100, hsl.l)) / 100;

	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;

	const [r, g, b] =
		h < 60
			? [c, x, 0]
			: h < 120
				? [x, c, 0]
				: h < 180
					? [0, c, x]
					: h < 240
						? [0, x, c]
						: h < 300
							? [x, 0, c]
							: [c, 0, x];

	return {
		r: Math.round(((r ?? 0) + m) * 255),
		g: Math.round(((g ?? 0) + m) * 255),
		b: Math.round(((b ?? 0) + m) * 255)
	};
}

export function toHslString(hsl: TpHsl): string {
	return `hsl(${String(hsl.h)} ${String(hsl.s)}% ${String(hsl.l)}%)`;
}

/* ───────────────────────────────────────────────────────────── contrast */

/** WCAG 2.1 relative luminance. The 0.03928 kink is the sRGB transfer curve. */
export function relativeLuminance(rgb: TpRgb): number {
	const channel = (value: number): number => {
		const v = Math.max(0, Math.min(255, value)) / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** 1 to 21. Symmetric — WCAG puts the lighter colour on top by definition. */
export function contrastRatio(a: TpRgb, b: TpRgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	const lighter = Math.max(la, lb);
	const darker = Math.min(la, lb);
	return (lighter + 0.05) / (darker + 0.05);
}

export type TpContrastVerdict = 'AAA' | 'AA' | 'AA-large' | 'fail';

/**
 * WCAG 2.1 §1.4.3 and §1.4.6 for **normal-size** text: 4.5 is AA, 7 is AAA, and
 * 3 is AA for large text only — which is a real pass and is named as one rather
 * than folded into "fail", because doc 13 §3's hero numerals are large text.
 */
export function contrastVerdict(ratio: number): TpContrastVerdict {
	if (ratio >= 7) return 'AAA';
	if (ratio >= 4.5) return 'AA';
	if (ratio >= 3) return 'AA-large';
	return 'fail';
}

/* ───────────────────────────────────────────────────────────────── ramp */

/**
 * doc 07 §7's five-step tint/shade ramp: lighter above the colour, darker
 * below, with the colour itself in the middle.
 *
 * Interpolated in HSL lightness rather than toward white and black in RGB.
 * Mixing toward white in RGB desaturates as it lightens, so a ramp built that
 * way loses the hue at both ends and stops being a ramp *of* the colour.
 */
export function ramp(rgb: TpRgb, steps = 5): TpRgb[] {
	const base = rgbToHsl(rgb);
	const half = Math.floor(steps / 2);

	return Array.from({ length: steps }, (_value, index) => {
		const offset = index - half;
		if (offset === 0) return rgb;
		// Toward 95 going up and toward 10 going down, so neither end reaches
		// pure white or pure black — both of those are the same colour whatever
		// you started from.
		const target = offset < 0 ? 95 : 10;
		const t = Math.abs(offset) / (half + 1);
		return hslToRgb({ h: base.h, s: base.s, l: Math.round(base.l + (target - base.l) * t) });
	});
}
