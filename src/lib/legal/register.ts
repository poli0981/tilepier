import type { m } from '$lib/paraglide/messages';

/**
 * doc 16 §5's curated obligation register, as data — the legally load-bearing
 * half of /legal/licenses, hand-authored because no script can produce it.
 * (The other half, every dependency's licence text, is
 * `licenses.generated.json`, which `pnpm licenses:gen` writes.)
 *
 * Item names and licence identifiers are proper nouns and stay untranslated;
 * only the obligation is a message. `doc` is the doc 16 §5 "Item" cell a row
 * answers to: `register.test.ts` holds the two to each other, row for row, so
 * a source added to the doc cannot be missing here. Until Week 8 the page kept
 * its own list, and it was two rows short of the doc — the quote dataset and
 * qrcode-generator — and silent on the icons.
 */

type TpObligation = Extract<keyof typeof m, `legal.licenses.ob_${string}`>;

export interface TpRegisterRow {
	/** The doc 16 §5 "Item" cell this row answers to. */
	doc: string;
	item: string;
	/** Where the source lives; the item is a link when there is one place to go. */
	href?: string;
	licence: string;
	licenceHref?: string;
	obligation: TpObligation;
}

const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';

export const REGISTER: readonly TpRegisterRow[] = [
	{
		doc: 'Open-Meteo data',
		item: 'Open-Meteo',
		href: 'https://open-meteo.com/',
		licence: 'CC BY 4.0',
		licenceHref: CC_BY_4,
		obligation: 'legal.licenses.ob_open_meteo'
	},
	{
		doc: 'ExchangeRate-API open endpoint',
		item: 'ExchangeRate-API',
		href: 'https://www.exchangerate-api.com',
		licence: 'free tier',
		obligation: 'legal.licenses.ob_exchangerate'
	},
	{
		doc: 'OpenStreetMap data (tiles, geocoding)',
		item: 'OpenStreetMap',
		href: 'https://www.openstreetmap.org/copyright',
		licence: 'ODbL',
		licenceHref: 'https://opendatacommons.org/licenses/odbl/',
		obligation: 'legal.licenses.ob_osm'
	},
	{
		doc: 'OpenFreeMap',
		item: 'OpenFreeMap',
		href: 'https://openfreemap.org',
		licence: 'free tiles',
		obligation: 'legal.licenses.ob_openfreemap'
	},
	{
		doc: "OpenMapTiles (the tiles' schema and styles)",
		item: 'OpenMapTiles',
		href: 'https://openmaptiles.org',
		licence: 'CC BY 4.0 · BSD-3',
		licenceHref: CC_BY_4,
		obligation: 'legal.licenses.ob_openmaptiles'
	},
	{
		doc: 'Photon (komoot)',
		item: 'Photon (komoot)',
		href: 'https://photon.komoot.io',
		licence: 'Apache-2.0',
		obligation: 'legal.licenses.ob_photon'
	},
	{
		doc: 'Nominatim',
		item: 'Nominatim',
		href: 'https://nominatim.org',
		licence: 'ODbL + policy',
		licenceHref: 'https://operations.osmfoundation.org/policies/nominatim/',
		obligation: 'legal.licenses.ob_nominatim'
	},
	{
		doc: 'Finnhub / Twelve Data / Binance.US',
		item: 'Finnhub · Twelve Data · Binance.US',
		licence: 'per ToS',
		obligation: 'legal.licenses.ob_markets'
	},
	{
		doc: 'gridstack (MIT), ECharts (Apache-2.0), MapLibre (BSD-3), Dexie (Apache-2.0), Svelte/Kit (MIT), Tailwind (MIT), marked (MIT), DOMPurify (Apache-2.0/MPL dual), music-metadata (MIT), Paraglide (MIT), fast-xml-parser (MIT), icon sources (ISC)',
		item: 'gridstack · ECharts · MapLibre · Dexie · Svelte · SvelteKit · Tailwind · marked · DOMPurify · music-metadata · Paraglide · fast-xml-parser · Lucide (icons)',
		licence: 'MIT · Apache-2.0 · BSD-3 · ISC',
		obligation: 'legal.licenses.ob_deps'
	},
	{
		doc: 'Bundled quote dataset (from QuoteAtlas)',
		item: 'QuoteAtlas (quote dataset)',
		licence: 'CC0 1.0',
		licenceHref: 'https://creativecommons.org/publicdomain/zero/1.0/',
		obligation: 'legal.licenses.ob_quotes'
	},
	{
		doc: 'qrcode-generator (Kazuhiko Arase)',
		item: 'qrcode-generator',
		href: 'https://github.com/kazuhikoarase/qrcode-generator',
		licence: 'MIT',
		obligation: 'legal.licenses.ob_qrcode'
	},
	{
		doc: 'Be Vietnam Pro, JetBrains Mono',
		item: 'Be Vietnam Pro · JetBrains Mono',
		licence: 'OFL 1.1',
		licenceHref: 'https://openfontlicense.org',
		obligation: 'legal.licenses.ob_fonts'
	},
	{
		doc: 'Hồ Ngọc Đức lunar algorithm',
		item: 'Hồ Ngọc Đức — âm lịch',
		licence: 'published algorithm',
		obligation: 'legal.licenses.ob_lunar'
	}
];
