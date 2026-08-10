# 13 · UI / UX Spec

## 1. App frame

- Top bar (48 px): logo-mark (tide-gauge tile) + wordmark, center empty
  (calm), right cluster: add-widget, edit-mode toggle, settings, about.
  Bar hides on scroll-down / reveals on scroll-up (dashboard rarely
  scrolls on desktop; matters on mobile).
- Dashboard fills the viewport; grid max-width 1680 px centered;
  page padding 16/24 px.
- No footer on the dashboard. Legal/about links live in Settings and the
  static pages.

## 2. Modes

- **View mode (default):** grid inert (doc 06 §5.5). Hover on a tile shows
  only the open-detail affordance (corner expand icon fading in). Calm is
  the point.
- **Edit mode:** entered via top-bar toggle or long-press (touch, 500 ms).
  Tiles show: header drag zone (`.tp-drag`, entire tile top 32 px),
  se-resize handle, remove (×) and settings (⚙) corner buttons; grid
  shows faint dot lattice; add-widget drawer accessible. A slim beacon
  strip under the top bar labels the mode ("đang chỉnh sửa — xong").
  Exit: toggle/Esc/"xong". Edit state is not persisted.

## 3. Tile anatomy & density tiers

```
┌────────────────────────────┐
│ header: icon · title · badge│  ← 28 px; hidden entirely at h=1
│ body (widget content)       │
│ footer: meta / actions      │  ← optional, ≤ 22 px
└────────────────────────────┘
```
Density tiers from grid size (host computes, passes in `size`):
- **S** (≤2×1): single hero value, no header text (icon only).
- **M** (default): header + primary content.
- **L** (≥4×3 or ≥3×4): header + content + secondary row (sparkline,
  extra rows). Widgets must implement all tiers they allow via `sizes`.

## 4. Add-widget drawer

Right-side sheet (mobile: bottom sheet). Manifest cards grouped by
category: icon, name, one-line description, size-footprint glyph
(mini 12-col diagram), Add button. Already-added single-instance widgets
show "on deck" disabled state. Search filters by name.

## 5. Detail expansion (FLIP)

1. Tap tile (view mode) → capture tile rect → `pushState('/w/{id}?i=…')`
   → overlay scrim (ink-950 @ 80%) → detail container animates from tile
   rect to centered panel (max 1120×min(86vh)) — transform+opacity only,
   260 ms spring.
2. Detail chunk lazy-loads during the animation; skeleton (doc §7) fills
   until ready — the motion masks the load.
3. Close: ×, Esc, scrim tap, or browser Back (popstate) → reverse FLIP to
   the live tile rect (recompute — grid may have reflowed).
4. Direct navigation to `/w/{id}`: no animation, full-screen detail,
   "◂ về bàn" returns to `/`; if the widget isn't on deck, offer
   "ghim vào bàn".
5. Reduced motion: crossfade 120 ms instead (doc 12 §7).

## 6. Responsive behavior

- Column collapse per doc 06 §5.4 (12/6/3/1). On collapse, gridstack
  compacts by row order; user's 12-col arrangement is preserved
  separately and restored on widen (store layout per max-column tier the
  user has actually edited in; naive single-layout in v1.0, per-tier
  layouts = v1.x backlog item — document limitation in About).
- Touch: drag/resize only in edit mode (long-press to enter), preventing
  scroll-hijack; detail panels become full-screen sheets under 768 px.

## 7. States (visual definitions)

- **Skeleton:** ink-850 blocks with the tide-gauge shimmer (doc 12 §5),
  never spinners inside tiles.
- **Stale badge:** small amber dot + "12ʼ" age in the tile header; tooltip
  explains; `stale-error` adds a retry icon-button.
- **Offline:** top-bar left gains a quiet amber "ngoại tuyến" chip; tiles
  keep last data with stale badges; networked empty tiles show offline
  card.
- **Error (inline):** icon + one sentence + retry; tile never blanks.
- **Toasts:** bottom-center, max 1 visible, 4 s, only for global events
  (429 backoff, import done, copy confirmations use micro-feedback
  instead).

## 8. Keyboard & a11y

- Global: `/` focuses widget-search-in-drawer? no — v1 keeps global keys
  minimal: `e` toggles edit, `Esc` closes topmost layer, `?` opens a
  shortcuts sheet. Media keys via Media Session (doc 09 §2).
- Detail panel = `role="dialog"` with focus trap + return-focus to tile.
- Tiles are `section` landmarks labeled by widget title + instance name.
- All interactive targets ≥ 40 px touch, visible `:focus-visible` ring
  (beacon, 2 px offset).
- Contrast: fg on ink-900 = 11.9:1; fg-mute = 5.1:1 (AA for normal text);
  audit every semantic-on-surface pair in Week 8 (doc 23).
- Charts: every ECharts view paired with an accessible summary line
  (e.g., "AAPL 1M: +4.2%, range 182–199") — cheap, honest a11y.

## 9. First-run experience

Fresh visitor: legal gate (doc 16 §2) → seeded default deck (clock 3×2,
weather empty-state 3×2, calendar 3×3, notes 3×3, quote 4×2) → one-time
coach overlay (three callouts: add widgets, edit mode, open detail —
dismiss forever). No account prompts, no tour videos, ≤ 30 s to a useful
deck.
