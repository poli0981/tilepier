#!/usr/bin/env node
/**
 * Draws TilePier's mark and renders every icon the app ships (doc 12 §5,
 * doc 17 §2).
 *
 * The mark is doc 12 §5's "rounded tile with the gauge cut into its left
 * edge": the tile surface, the tide gauge's ticks notched into its left side
 * (short, short, long, as `TpTideGauge` runs them), and the waterline in the
 * beacon colour. The colours are read from the dark theme in `src/app.css`, so
 * the icon cannot drift from the tokens it is drawn in.
 *
 * The PNGs are rendered by the Chromium that Playwright already installs, so
 * no image library joins the dependencies. The output is committed; run this
 * again only when the mark or a token changes. It is not part of CI.
 *
 *   pnpm icons:gen
 */
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const STATIC = join(ROOT, 'static');
const ICONS = join(STATIC, 'icons');

/** The first (dark, default) definition of each token in app.css. */
function token(css, name) {
	const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
	if (match === null) throw new Error(`app.css defines no --color-${name}`);
	return match[1].toLowerCase();
}

const css = readFileSync(join(ROOT, 'src', 'app.css'), 'utf8');
const colour = {
	harbor: token(css, 'ink-950'),
	tile: token(css, 'ink-900'),
	hairline: token(css, 'ink-700'),
	tick: token(css, 'fg-mute'),
	beacon: token(css, 'beacon')
};

/** The gauge's ticks, top to bottom, on the 64-unit grid. */
const TICKS = [14, 20, 26, 32, 38, 44, 50];

/** The water stands on the fourth tick, half way up: a line that covers one
 *  tick reads cleaner at 32 px than one that half-crosses two. */
const WATER = TICKS[3];

/**
 * The mark on a 64-unit grid. `background` fills the whole square for the
 * icons that must be opaque (maskable, Apple's); `scale` shrinks the mark
 * inside it, so a maskable crop never reaches the tile.
 */
function mark({ background = null, scale = 1 } = {}) {
	// The gauge's ticks, engraved along the tile's left edge: short, short,
	// long, as TpTideGauge runs them up its piling.
	const ticks = TICKS.map((y, index) => {
		const long = index % 3 === 2;
		return `<line x1="9" y1="${y}" x2="${long ? 21 : 15}" y2="${y}" stroke="${colour.tick}" stroke-width="2.4" stroke-linecap="round" opacity="${long ? 0.9 : 0.55}"/>`;
	}).join('');
	const water = WATER;
	const offset = (64 - 64 * scale) / 2;
	return [
		'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">',
		'<title>TilePier</title>',
		background === null ? '' : `<rect width="64" height="64" fill="${background}"/>`,
		`<g transform="translate(${offset} ${offset}) scale(${scale})">`,
		`<rect x="6" y="6" width="52" height="52" rx="12" fill="${colour.tile}" stroke="${colour.hairline}" stroke-width="2"/>`,
		ticks,
		// The waterline, the one thing that glows: a soft band under a firm line.
		`<line x1="9" y1="${water}" x2="44" y2="${water}" stroke="${colour.beacon}" stroke-width="8" stroke-linecap="round" opacity="0.25"/>`,
		`<line x1="9" y1="${water}" x2="44" y2="${water}" stroke="${colour.beacon}" stroke-width="3.5" stroke-linecap="round"/>`,
		'</g>',
		'</svg>'
	].join('');
}

async function render(page, svg, size) {
	await page.setViewportSize({ width: size, height: size });
	const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
	await page.setContent(
		`<html><body style="margin:0;background:transparent"><img src="${src}" width="${size}" height="${size}" style="display:block"></body></html>`
	);
	await page.locator('img').evaluate((img) => img.decode());
	return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

/** An .ico holding PNG images, which every browser that still asks for one reads. */
function ico(pngs) {
	const header = Buffer.alloc(6 + 16 * pngs.length);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(pngs.length, 4);
	let offset = header.length;
	pngs.forEach(({ size, png }, index) => {
		const entry = 6 + 16 * index;
		header.writeUInt8(size >= 256 ? 0 : size, entry);
		header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
		header.writeUInt16LE(1, entry + 4);
		header.writeUInt16LE(32, entry + 6);
		header.writeUInt32LE(png.length, entry + 8);
		header.writeUInt32LE(offset, entry + 12);
		offset += png.length;
	});
	return Buffer.concat([header, ...pngs.map(({ png }) => png)]);
}

mkdirSync(ICONS, { recursive: true });
const plain = mark();
writeFileSync(join(STATIC, 'favicon.svg'), `${plain}\n`);

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ deviceScaleFactor: 1 });
	writeFileSync(join(ICONS, 'icon-192.png'), await render(page, plain, 192));
	writeFileSync(join(ICONS, 'icon-512.png'), await render(page, plain, 512));
	// Maskable: full bleed, the tile inside the safe circle (40 % radius).
	writeFileSync(
		join(ICONS, 'maskable-512.png'),
		await render(page, mark({ background: colour.harbor, scale: 0.72 }), 512)
	);
	// Apple fills transparency with black and rounds the corners itself.
	writeFileSync(
		join(STATIC, 'apple-touch-icon.png'),
		await render(page, mark({ background: colour.harbor, scale: 0.78 }), 180)
	);
	writeFileSync(
		join(STATIC, 'favicon.ico'),
		ico([
			{ size: 16, png: await render(page, plain, 16) },
			{ size: 32, png: await render(page, plain, 32) }
		])
	);
} finally {
	await browser.close();
}
console.log('icons written to static/ and static/icons/');
