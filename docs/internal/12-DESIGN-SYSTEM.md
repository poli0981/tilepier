# 12 · Design System — "Đài quan trắc"

## 1. Concept

**Đài quan trắc** — "the observation deck." A coastal instrument station at
night: dark water, calibrated dials, one beacon light. The dashboard *is* an
instrument panel, so the design leans into it — precision, quiet, glow —
while refusing the two default aesthetics of 2026 (glassmorphism cards and
gradient-blob "AI product" pastels).

Feel words: **calibrated · quiet · tidal · luminous**. Anti-feel: glassy,
bubbly, corporate-SaaS, neon-cyberpunk.

Relationship to siblings: same *family discipline* as "Phòng đọc lúc nửa đêm"
(dark base, single accent, named motif) but a distinct identity — cooler
base, teal beacon, gauge motif. No shared tokens with any other project.

## 2. Core tokens (Tailwind 4 `@theme` in `src/app.css`)

```css
@theme {
  /* Surfaces — dark (default) */
  --color-ink-950: #070A0E;   /* page background: deep harbor */
  --color-ink-900: #0B0F14;   /* tile surface */
  --color-ink-850: #10161D;   /* raised surface / detail panels */
  --color-ink-700: #1C2530;   /* borders, hairlines */
  --color-ink-500: #3A4756;   /* disabled, gridlines */

  /* Text */
  --color-fg:      #DEE7EE;   /* primary text */
  --color-fg-mute: #8FA0B0;   /* secondary */
  --color-fg-dim:  #738292;   /* tertiary, timestamps (#5C6B7A until Week 8) */

  /* Scrollbar thumb (§9) — light theme #78858F */
  --color-scrollbar: #5C6B7A;

  /* Beacon (accent) — derived per theme from --tp-accent, see below */
  --color-beacon:      #46D5C8;
  --color-beacon-soft: #46D5C81F;  /* 12% wash */
  --color-beacon-deep: #2AA79C;    /* hover/pressed */

  /* Semantic */
  --color-up:     #57C785;   /* gains */
  --color-down:   #E8705F;   /* losses (red-orange, CB-safer vs green) */
  --color-warn:   #E8B750;   /* stale, amber lamp */
  --color-danger: #E45C5C;

  /* Chart series 2–5 (§4.3) — charts only */
  --color-chart-2: #7B8FF2;  --color-chart-3: #8798A8;
  --color-chart-4: #D9A441;  --color-chart-5: #C084D6;

  /* Shape & depth */
  --radius-tile: 14px;  --radius-ctl: 8px;
  --shadow-tile: 0 1px 0 #FFFFFF0A inset, 0 8px 24px #00000059;
}
```

Light theme: mirrored ramp on warm paper (`#F4F1EA` page, `#FFFFFF` tiles,
ink text `#1A222B`). Theme switch = `data-theme` attribute on
`<html>`; ECharts re-themes dynamically (v6 capability) via the token
bridge in `lib/charts` — one source of truth, charts never hardcode hex.

**Until Week 8 the light theme kept the dark theme's beacon and semantic
colours, and nothing had measured them on paper.** The beacon — also the focus
ring — was 1.81:1 on white; the gate's Accept button set paper text on it at
1.60:1, before any script, for every reader whose system is light; `up` was
2.12, `warn` 1.86. The light theme now carries its own: `fg-dim` #616E77,
`up` #007D40, `down` #B94637, `warn` #916400, `danger` #C13B3F, chart steps
#6E81E3 · #7A8A9A · #B27F05 · #AD72C2, and a beacon derived for paper (below).
Each was solved by keeping the dark colour's OKLCH hue and chroma and moving
only its lightness until it cleared the ratio on all three light surfaces.

Measured by `ui/contrast.svelte.test.ts` — the real stylesheet, the real
store, the browser resolving every token, the pixels painted and read back.
The lowest ratio of each, across ink-950, -900 and -850:

| token | dark | light | need |
|---|--:|--:|--:|
| fg | 14.53 | 14.24 | 4.5 |
| fg-mute | 6.78 | 6.26 | 4.5 |
| fg-dim | 4.62 | 4.65 | 4.5 |
| up / down | 8.59 / 5.99 | 4.65 / 4.66 | 4.5 |
| warn / danger | 9.81 / 5.18 | 4.62 / 4.70 | 4.5 |
| beacon, worst accent of any hue | 5.4 | 5.6 | 4.5 |
| scrollbar thumb | 3.33 | 3.35 | 3 |
| chart steps 2–5 | 6.11 | 3.12 | 3 |

The beacon row holds for text on every surface, for text on the beacon's own
wash, and for ink-950 text on the beacon and on its pressed shade. A colour
token the suite has not given a role fails it, so a new one cannot ship
unmeasured.

**Built 2026-08-30, and one rule makes the whole claim true or false.**
`chart.setTheme()` merges into a chart's *defaults*, so any colour left in the
option outranks the theme forever: a chart can observe `data-theme`, call
`setTheme` on every switch, throw nothing, log nothing — and never change a
pixel. So the option is **colourless by construction** and every colour lives in
`charts/theme.ts`. The module split enforces it rather than asking for it:
`echarts.ts` registers and creates, `options.ts` holds the vocabulary and the
shared geometry with nothing but type imports, and `theme.ts` is the only place
a colour appears. `hourlyOption`'s test asserts the option contains no `#`,
`rgb` or `hsl` at all, which is the assertion that would catch the drift.

Two smaller findings from the same work. Tokens reach a chart as **literal
hex only**: `getComputedStyle().getPropertyValue()` returns a custom property's
substituted-but-unresolved text, so `color-mix()` and `oklch()` arrive at
zrender as those strings, and zrender's parser returns nothing for them — the
chart draws invisibly rather than wrongly. `readChartTokens` refuses anything
that is not literal hex and falls back. And ECharts 6 deprecated
`grid.containLabel` in favour of `outerBoundsMode` / `outerBoundsContain`; the
old key warns in dev and falls back internally unless a legacy shim is
installed, which would cost bytes to buy back a deprecated path.

Accent is user-overridable in Settings (stored `tp.settings.accent`);
derived soft/deep values computed in OKLCH so any accent stays usable.
Semantic colors are **not** overridable.

Mechanically: JavaScript sets **only** `--tp-accent` on `<html>` — the
reader's choice, as chosen. `app.css` derives `--color-beacon` from it per
theme with relative colour syntax, holding the accent's hue and moving its
lightness to the far side of the surfaces — at least 0.66 in OKLCH on deep
water, at most 0.44 on paper — with chroma capped at 0.16. `--color-beacon-soft`
and `--color-beacon-deep` derive from the beacon with `color-mix(in oklch, …)`
and `oklch(from …)`. There is no runtime colour module to ship, and any accent
— a swatch or anything the colour picker returns — stays legible in both
themes; none of the six swatches moves in the dark theme. An engine without
relative colour syntax shows the accent as chosen in the dark theme and the
default's paper teal (#00665D) in the light one. (Clarified 2026-08-19 —
"computed in OKLCH at runtime" was read as needing a JS colour library.
Amended Week 8: the store set `--color-beacon` itself until then, and an
inline value outranks every theme rule, so the light theme could not darken an
accent it could not reach.)

## 2a. Spacing

Added 2026-08-19: this doc defined no spacing scale at all, and doc 13 carried
only per-component pixel values, so "design tokens only" (doc 20 §1) had nothing
to point at for layout.

Tailwind 4's `--spacing` (0.25 rem) is declared explicitly in `@theme` and is
the only scale. Permitted steps: **1 · 2 · 3 · 4 · 6 · 8 · 12 · 16** →
4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 px. Doc 13's per-component values map onto
these.

Two grid constants cannot map, because they are gridstack's own geometry
(doc 06 §5.4): `cellHeight: 72` and `margin: 12`. They are declared once in
`TpGrid.svelte` and nowhere else. Three chrome constants that doc 13 §1 fixes get
tokens rather than repetition: `--tp-bar-h: 48px`, `--tp-page-pad: 16px`
(24 px at ≥ 768 px) and `--tp-deck-max: 1680px`.

**Where they actually live (corrected 2026-09-23).** Until then this section
was wrong on both counts:

- **`--spacing` was never declared.** It existed only as Tailwind's default.
  It is now restated in `@theme`, so the scale this section names cannot
  change with a Tailwind release.
- **The chrome tokens did not exist at all.** Every use carried its own
  fallback (`var(--tp-page-pad, 16px)`), so nothing failed. But the top bar
  sat on the fallback 16 px while `main` hardcoded 24 px, and on anything
  wider than a phone the bar and the grid never shared an edge.

The three chrome tokens are plain custom properties on `:root` in `app.css`,
not `@theme` entries. They are not a Tailwind namespace, and the padding
changes at 768 px, which a `@theme` block cannot express. The fallbacks are
gone, so a missing token now shows as a broken layout. `e2e/top-bar.e2e.ts`
measures the brand's left edge against the grid container's at 375, 768, 1280
and 1920 px.

## 3. Typography

| Role | Font | Notes |
|------|------|-------|
| UI & prose | **Be Vietnam Pro** (400/500/600) | Vietnamese-designed; flawless diacritics; local identity. Self-hosted woff2, `vietnamese` + `latin` subsets only. |
| Data & numerals | **JetBrains Mono** (400/600) | All numbers everywhere: clocks, prices, temps. `font-feature-settings: "tnum"` and fixed-width columns stop jitter on live values. |

Scale (px @16 base): 12 · 13 · 15 (body) · 18 · 24 · 34 · 48 (hero numerals).
Line-height 1.5 prose, 1.1 numerals. **Rule: if it's a number the user
watches change, it's mono + tnum. No exceptions.**

## 4. Color usage rules

1. One beacon per view. The accent marks *the* interactive/primary element,
   not decoration. Category icons are `fg-mute`, never rainbow.
2. up/down pair verified for deuteranopia (green/red-orange separation +
   always paired with a sign glyph — color is never the only channel).
   **And the colour follows the glyph, not the number behind it** (2026-09-23):
   a move is coloured from `changeDirection`, which reads the sign off the
   formatted text. −0.004 % prints as an unsigned "0%", so it is uncoloured.
   Colouring from the raw fraction put a red "0%" beside BTC on production —
   colour carrying a fall the text had rounded away, which is this rule broken
   from the other side.
3. Charts: series-1 = beacon; series-2 = `#7B8FF2` (harbor blue, charts
   only); further series from a fixed 5-step calibrated ramp defined in the
   ECharts theme — widgets don't invent colors.

   The ramp was two steps until 2026-08-30, when the weather detail's cloud
   band became the first third series. It is now
   `beacon · #7B8FF2 · #8798A8 · #D9A441 · #C084D6`, in `charts/theme.ts`, and
   it descends in weight on purpose: a third series is usually context behind
   the first two rather than a rival to them, and the accent has to stay the
   one beacon in the view (rule 1). Step 1 is the beacon — the accent is
   user-overridable, so series-1 follows it — and since Week 8 steps 2–5 are
   tokens too (`--color-chart-2…5`), with light-theme values of their own.
   **A step that reads as the reader's own accent is skipped.** This said, until
   Week 8, that none of steps 3–5 was one of the six selectable accents, and a
   test asserted exactly that — while step 2 *was* one (harbor blue), and amber
   and violet sat 0.06 and 0.03 in OKLab from steps 4 and 5. Three of six
   swatches drew a second series in the reader's colour. `chartTheme` now
   drops any step closer than 0.12 in OKLab to series-1 and moves the rest up,
   in order, with the text colour as the last resort. The bridge paints each
   token to a pixel rather than reading its text, so the derived beacon
   reaches the chart as the colour the theme gave it.
   **The candle pair is not in that ramp, and could not be** (added
   2026-09-01, with the markets detail). ECharts takes a candlestick's four
   colours from `itemStyle.color`/`color0`/`borderColor`/`borderColor0` rather
   than from the series palette, so the token bridge built in Week 4 covered
   every chart in the app except the one Week 5 is about — the candles would
   have drawn in ECharts' own red and green, a pair nobody has measured. They
   are supplied as *theme* defaults in `charts/theme.ts` from `--color-up` and
   `--color-down`, which keeps the option colourless like every other one here.

4. Backgrounds never pure black; hairlines (`ink-700`) over shadows for
   separation. Shadows exist only at the tile level.

## 5. Motif — "Tide Gauge"

The signature mark (Waveline's sibling): a vertical tick ruler like the
water-level gauge on a pier piling — short-short-long repeating ticks with
the current level glowing beacon.

Appearances (subtle, ≤ 1 per view): loading skeleton shimmer is a rising
tide-gauge; detail-view left edge carries a faint tick rail; the logo is a
rounded tile with the gauge cut into its left edge; empty states float a
small gauge illustration. Implementation: one inline SVG component
`TpTideGauge` with `level` and `animated` props — CSS-animatable,
respects reduced-motion.

**The logo, as drawn (2026-09-29).** `scripts/gen-icons.mjs` (`pnpm
icons:gen`) draws the mark from the tokens in `app.css`:
- the tile in ink-900 with an ink-700 hairline;
- the gauge's ticks engraved along its left edge, short, short, long;
- the waterline in beacon across them at half height, so it covers one tick
  rather than half-crossing two.

The script then renders, in Playwright's Chromium:
- `favicon.svg` and `favicon.ico` (16 and 32 px);
- `apple-touch-icon.png` (180 px, opaque);
- the manifest's 192/512 PNGs;
- a 512 maskable with the tile inside the safe circle.

Until then, the tab showed SvelteKit's stock Svelte logo (an inlined `data:`
URI), and the manifest named a `/favicon.svg` that answered with the 404
page.

## 6. Iconography

Single internal set (`lib/ui/icons`, tree-shaken Svelte components):
1.75 px stroke, 24 px grid, round caps — hand-picked/adapted (Lucide-style
geometry, ISC-licensed sources, attributed in licenses page). Weather
icons: dedicated set mapped from WMO codes, same stroke language, in
`lib/ui/icons/wmo.ts` rather than in `ICON_PATHS` - that record is reached from
the entry chunk, so a glyph added there costs bytes for every reader including
the ones with no weather tile. No emoji anywhere in UI chrome.

**Seven glyphs shipped in Week 4, not the sixteen this line asked for**
(2026-08-30). Sixteen hand-drawn 24 px paths is illustration time no dependency
covers, and Week 4 was already four times its budget; the cut was taken in
depth rather than in widgets, per doc 23's slip policy. `wmoGlyph` still maps
the whole WMO range onto the seven, so nothing upstream sends falls through to
`unknown`.

## 7. Motion

- Springs via `svelte/motion` — stiffness 0.18 / damping 0.75 house values.
- Tile enter: 180 ms fade+2 % scale; detail FLIP 260 ms (doc 13 §5);
  value changes: 120 ms color pulse (no layout shift).
- `prefers-reduced-motion` (or setting): FLIP → crossfade, pulses → none,
  gauge animations static. Enforced centrally via a `motionOK()` helper —
  components never read the media query directly.
- Marquee (the music tile's title lines, Week 7): a line slides only when it
  does not fit **and** motion is welcome (`:root[data-motion='ok']`);
  otherwise it ends in an ellipsis, and the song's line carries the whole
  title in its `title` attribute.

## 8. Voice

UI copy: lowercase-calm, terse, no exclamation marks, no anthropomorphizing.
Empty states explain + one action ("chưa có ghi chú — tạo ghi chú đầu tiên").
Errors say what happened and what happens next ("dữ liệu cũ 12 phút —
sẽ thử lại"). Same register in EN and VI (doc 14 §5).

## 9. Scrollbars

Added 2026-10-06, at the owner's request (doc 23, Week 8).

- **Thin, in the theme's colours, drawn with the standard properties only.**
  `scrollbar-width: thin` on every element, and one `scrollbar-color:
  var(--color-scrollbar) transparent` on the root, which every scroller
  inherits. Browsers ignore `::-webkit-scrollbar` on any element where either
  property is set, so there is no second path to keep in step, and no script.
  Supported by Chrome and Edge 121, Firefox 64 and Safari 18.2 (`scrollbar-color`
  from Safari 26.2; before that Safari draws its own thin bar). Forced-colours
  mode resets the colour by itself.
- **The thumb is neutral**: `--color-scrollbar` (#5C6B7A dark, #78858F light),
  at least 3:1 against ink-950, -900 and -850 of its theme, so the bar is a
  visible control rather than decoration. It is not the beacon (§4.1: one
  beacon per view), and it is a token of its own so that a change to `fg-dim`
  does not make it louder. The track is transparent, so a pane's own surface
  shows through.
- **The page reserves its gutter** (`scrollbar-gutter: stable`): the deck's
  column count comes from its width, and a scrollbar appearing used to change
  it (doc 06 §5.4). The strip of gutter beside a full-screen scrim is not
  dimmed; that is accepted, and it does not appear where scrollbars overlay.
- **Settings → Appearance → Scrollbars: shown | hidden**, shown by default.
  Hidden sets `data-scrollbars="hidden"` on `<html>` — `static/boot.js` before
  first paint, the settings store after hydration — and `scrollbar-width: none`
  on everything. It is never `overflow: hidden`: the wheel, the keyboard and
  touch all still scroll, which the settings note tells the reader. Hidden
  removes the gutter too, so switching it can change the column count once at a
  boundary width; that is the reader's own action, like resizing the window.
- How it is tested: computed style in `ui/scrollbars.svelte.test.ts` and pixels
  in `e2e/scrollbars`, the one spec that runs with real scrollbars (doc 19 §4).
