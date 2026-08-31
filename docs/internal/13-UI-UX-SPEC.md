# 13 · UI / UX Spec

## 1. App frame

- Top bar (48 px): logo-mark (tide-gauge tile) + wordmark, center empty
  (calm), right cluster: add-widget, edit-mode toggle, settings, about.
  Bar hides on scroll-down / reveals on scroll-up (dashboard rarely
  scrolls on desktop; matters on mobile).
- Dashboard fills the viewport; grid max-width 1680 px centered;
  page padding 16/24 px. That padding is measured to the **grid container**;
  tiles then sit 12 px inside it (doc 06 §5 rules 4 and 12), so the outer gutter
  reads 28/36 px against a 24 px gutter between tiles. The asymmetry is
  deliberate — dropping the page padding to match would desynchronise the deck
  from the top bar and the coach rails, which are on `--tp-page-pad`, and at
  <768 px would put content 12 px from the screen edge. (Written down
  2026-08-30, when restoring the item margin made the two numbers visible.)
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
At **h=1 the header leaves the flow** rather than disappearing: it is the drag
handle (`draggable.handle: '.tp-drag'`) and it carries the edit-mode remove
button, so `display: none` would make a 1-row tile neither draggable nor
removable. It becomes `position: absolute` across the top instead, transparent
to the pointer in view mode and solid again in edit mode, and the body takes the
full height, minus a reserve on the right for the controls the header floats
above — without it a widget that uses the full width runs its last characters
under the expand icon, which the clock did not show because a hero numeral is
short and left-aligned. Keyed on `h`, not on the tier — tier S is
`w<=2 && h<=1`, so a 3×1 tile is tier M and needs the same treatment. (Clarified 2026-08-30: this line
said "hidden entirely" and the code hid only the title, which cost an h=1 tile
28 of its 48 px.)

**The stale badge is in the host header, and §7 describes what the code does**
(2026-08-31). It lived in the widget's body from 2026-08-30, because
`TpWidgetHost` is mounted imperatively by `TpGrid` and a new reactive prop
would have to be owned by `TpGrid` — which has no access to a widget's `swr`
handle. That note asked for the choice to be made rather than inherited, on the
arithmetic that leaving it costs five copies by Week 6 and moving it costs one
core module. **The module was cheaper than the note assumed.**

`src/lib/core/tile-status.ts` is a `SvelteMap` keyed by `instanceId`, and the
host reads it with one `$derived`. A prop has to cross `mount()`'s one-shot
props object; a module import crosses nothing, so the constraint that made this
look expensive was never in the way. It carries no rune of its own — a
`SvelteMap`'s reactivity is compiled inside the `svelte` package — which is why
the filename has no `.svelte.` infix, and it is the first module in this repo
to rely on that. `grid/TpWidgetHost.svelte.test.ts` exists to check exactly
that, rather than leave it to a badge that never appears.

Two things the move settled that the body badge had wrong:

- **`rate-limited` now raises a badge.** doc 04 §2's table maps it to
  `stale-error`, but the weather body only rendered its error card when there
  was *nothing* underneath — so a tile holding cached data through a 429 showed
  no badge at all.
- **At h=1 the badge is a lamp and nothing else.** The header is a floating
  strip there (above), so words would sit on the tile's own content; the
  sentence moves into `title` and the accessible name, and the body's
  right-hand reserve grows with the cluster the badge joined. `currency` is the
  first widget that can reach h=1 with data, which is what forced the question.

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
- Contrast: **measured 2026-08-28**, when `widgets/toolbox/color.ts` gave the
  suite something to measure with. `fg` on `ink-900` is **15.35:1** and `fg-mute`
  is **7.16:1** — both comfortably AA, and both better than the 11.9 and 5.1 this
  line asserted before anything had computed them. `color.test.ts` now asserts
  the pair against the tokens, so the two cannot drift apart again.

  **`fg-dim` on `ink-900` is 3.51:1**, which is AA for large text only and fails
  AA for normal text. doc 12 §2 gives it "tertiary, timestamps", and it is used
  at `--text-2xs` for the notes updated-ago line, the clock's zone deltas and the
  calendar's lunar day numbers — all normal-size text. Left as measured rather
  than fixed here: raising it is a design-token change, and doc 23 puts the
  contrast audit in Week 8 where the whole ramp can move together. Recorded so
  that audit starts from a known finding rather than rediscovering it.

  A second finding for the same audit, recorded 2026-08-28: **tile controls are
  below the 40 px target above.** The todo tile has shipped 36, 32 and 28 px
  controls since Week 2 and the toolbox tile follows it at 28 px, because three
  40 px tabs plus a panel do not fit a 2×2 tile. Detail panels do hold the rule
  and the toolbox detail is built to it. Either the rule wants a tile exception
  or the tiles want redesigning; that is a Week 8 call, and it is written down
  here so it is made rather than discovered.

  The full sweep of every semantic-on-surface pair remains Week 8 (doc 23).
- Charts: every ECharts view paired with an accessible summary line
  (e.g., "AAPL 1M: +4.2%, range 182–199") — cheap, honest a11y.

## 9. First-run experience

Fresh visitor: legal gate (doc 16 §2) → seeded default deck (clock 3×2,
weather empty-state 3×2, calendar 3×3, notes 3×3, quote 4×2) → one-time
coach overlay (three callouts: add widgets, edit mode, open detail —
dismiss forever). No account prompts, no tour videos, ≤ 30 s to a useful
deck.

The seed is **filtered through the registry**, so it only ever contains widgets
that exist in the current build. It was `clock` alone in Week 1, `clock` +
`notes` from Week 2, and is **four tiles from Week 3** — clock, calendar, notes,
quote. M1 delivers a deck you can arrange, and a deck seeded with widgets that
do not exist is not one. (Corrected 2026-08-19.)

The five-tile deck above is the **Week 4** state, not Week 3's: `weather` is in
the list and lands in Week 4 (doc 23), so it is filtered out until then. Said
plainly on 2026-08-28, because the previous sentence claimed Week 3 and the
e2e suite carried the number as a literal in six files — it now lives once, in
`e2e/_lib/seed.ts`.

"Dismiss forever" is `tp.settings.v1.coachDismissed` (doc 05 §2). It had nowhere
to live under the three-key rule until that field was added.

## 10. Settings (`/settings`)

Added 2026-08-19. Doc 23 listed "settings page + store" as a Week 1 deliverable
and no doc in the suite had a section for it (doc 22 §Exit review, item 1); the
requirements existed only as a dozen scattered references across docs 05, 12,
14, 16, 18 and 19. This section collects them.

**A route, not a modal**, inside the `(app)` route group. Four reasons, in
order: it is behind the legal gate because it exposes data wipe and
diagnostics; it has nine sections, past the point a sheet stays honest;
`#report` is a deep-link target from the 500 page (doc 17 §1); and a top-bar
`<a href>` works before hydration where an `onclick` would not.

Single column, `max-width: 42rem`, matching `/legal`'s prose measure. Sections
are `<section>` with an `<h2>`; rows are label-left / control-right at ≥ 640 px
and stacked below. **No save button** — every control writes through
`stores/settings.svelte.ts` immediately. Local-first means there is nothing to
submit.

| # | Section | Contents | Lands |
|---|---------|----------|-------|
| 1 | Ngôn ngữ / Language | vi \| en segmented control; changing it reloads (doc 14 §1) | Week 1 |
| 2 | Giao diện / Appearance | theme (dark \| light \| system), accent swatches + custom, reduced motion (system \| on \| off) | Week 1 |
| 3 | Hiển thị / Display | 24-hour clock, week starts on | Week 1 |
| 4 | Bàn làm việc / Deck | reset layout to the seeded default (confirm) | Week 1 |
| 5 | Sao lưu / Backup | export JSON, import with dry-run diff (doc 05 §6) | Week 2 ✓ |
| 6 | Bộ nhớ / Storage | `navigator.storage.estimate()`, warn > 80 %, "Xóa toàn bộ dữ liệu" (doc 16 §3.6) | Week 1 |
| 7 | Báo lỗi / Report a bug | the doc 18 §4 dialog | Week 1 |
| 8 | Chẩn đoán / Diagnostics | ring buffer, scheduler table, swr cache ages, breaker states — hidden unless `?debug=1` or `tp.settings.v1.debug` | Week 1, partial |
| 9 | Giới thiệu / About | version + short SHA, links to `/about`, `/legal/*`, repository, licence | Week 1 |

Section 5 was **omitted entirely** until it landed — an empty section header is
noise, and a disabled control that has never worked is worse. It arrived on
2026-08-27 and sits directly above Storage, so that section 6's erase confirm
can point at it: the copy now says "export a backup above first" rather than
"there is no automatic backup yet".

Section 8 ships in Week 1 with the two data sources that exist by then, the log
ring buffer and `scheduler.inspect()` (doc 04 §3).

**The swr rows arrived 2026-08-28** with `core/swr.svelte.ts`, reading
`swrCache.inspect()` — key, status and age in seconds. Nothing on the deck is
networked until Week 4, so the table normally reads "nothing cached"; that is
the honest thing for it to say rather than being left out until it can be full.

**The breaker rows did not, and that is a deliberate deferral to Week 5.** They
need `GET /api/_health`, which doc 11 §9 gates behind `env.DEV_DASH_TOKEN` — a
secret, and secrets are not declared in `wrangler.jsonc`. Typing one means
`wrangler types` reading a gitignored `.dev.vars`, so the committed
`worker-configuration.d.ts` would differ between a developer's checkout and CI
and `wrangler types --check` would fail on one of them. That is a real problem
with a real answer and it is not a Week 3 problem: doc 23 puts the quota
telemetry watch at Week 5, which is when a breaker table first has anything to
say. Recorded here rather than left as a gap in a numbered list.

Section 7 ships in Week 1 deliberately, out of order of apparent usefulness: it
is what makes the ring buffer worth having, and M1's stated QA strategy is
dogfooding in production.

The page body lives in `src/lib/ui/settings/TpSettingsPanel.svelte`; the route
is a thin wrapper. That keeps the panel testable in the browser project without
stubbing `$app/*`.

## 11. About (`/about`)

Prerendered and **outside** the `(app)` group, next to `/legal/*` and sharing
their prose layout, so the gate can link to it and a first-time visitor can find
out what they are agreeing to before agreeing. Bilingual via the doc 14 §6
dual-render mechanism.

Contents: what TilePier is (three sentences); the privacy one-liner with a link
to `/legal/privacy`; version and short SHA; licence and repository links; and —
the reason this page has to exist at all — **the two documented limitations**:
layout is stored once rather than per breakpoint (§6 above), and two open tabs
are last-writer-wins (doc 04 §7). Both docs already point here; the page did
not exist.
