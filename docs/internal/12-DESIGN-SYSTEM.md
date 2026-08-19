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
  --color-fg-dim:  #5C6B7A;   /* tertiary, timestamps */

  /* Beacon (accent) */
  --color-beacon:      #46D5C8;
  --color-beacon-soft: #46D5C81F;  /* 12% wash */
  --color-beacon-deep: #2AA79C;    /* hover/pressed */

  /* Semantic */
  --color-up:     #57C785;   /* gains */
  --color-down:   #E8705F;   /* losses (red-orange, CB-safer vs green) */
  --color-warn:   #E8B750;   /* stale, amber lamp */
  --color-danger: #E45C5C;

  /* Shape & depth */
  --radius-tile: 14px;  --radius-ctl: 8px;
  --shadow-tile: 0 1px 0 #FFFFFF0A inset, 0 8px 24px #00000059;
}
```

Light theme: mirrored ramp on warm paper (`#F4F1EA` page, `#FFFFFF` tiles,
ink text `#1A222B`, same beacon). Theme switch = `data-theme` attribute on
`<html>`; ECharts re-themes dynamically (v6 capability) via the token
bridge in `lib/charts` — one source of truth, charts never hardcode hex.

Accent is user-overridable in Settings (stored `tp.settings.accent`);
derived soft/deep values computed in OKLCH so any accent stays usable.
Semantic colors are **not** overridable.

Mechanically: JavaScript sets **only** `--color-beacon` on `<html>`.
`--color-beacon-soft` and `--color-beacon-deep` are derived in `app.css` with
`color-mix(in oklch, …)`, so there is no runtime colour module to ship, and a
custom accent stays correct in both themes. (Clarified 2026-08-19 — "computed
in OKLCH at runtime" was read as needing a JS colour library.)

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
`TpGrid.svelte` and nowhere else. Two chrome constants that doc 13 §1 fixes get
tokens rather than repetition: `--tp-bar-h: 48px` and `--tp-page-pad: 16px`
(24 px at ≥ 768 px).

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
3. Charts: series-1 = beacon; series-2 = `#7B8FF2` (harbor blue, charts
   only); further series from a fixed 5-step calibrated ramp defined in the
   ECharts theme — widgets don't invent colors.
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

## 6. Iconography

Single internal set (`lib/ui/icons`, tree-shaken Svelte components):
1.75 px stroke, 24 px grid, round caps — hand-picked/adapted (Lucide-style
geometry, ISC-licensed sources, attributed in licenses page). Weather
icons: dedicated 16-glyph set mapped from WMO codes, same stroke language.
No emoji anywhere in UI chrome.

## 7. Motion

- Springs via `svelte/motion` — stiffness 0.18 / damping 0.75 house values.
- Tile enter: 180 ms fade+2 % scale; detail FLIP 260 ms (doc 13 §5);
  value changes: 120 ms color pulse (no layout shift).
- `prefers-reduced-motion` (or setting): FLIP → crossfade, pulses → none,
  gauge animations static. Enforced centrally via a `motionOK()` helper —
  components never read the media query directly.

## 8. Voice

UI copy: lowercase-calm, terse, no exclamation marks, no anthropomorphizing.
Empty states explain + one action ("chưa có ghi chú — tạo ghi chú đầu tiên").
Errors say what happened and what happens next ("dữ liệu cũ 12 phút —
sẽ thử lại"). Same register in EN and VI (doc 14 §5).
