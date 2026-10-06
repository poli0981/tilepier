# 13 · UI / UX Spec

## 1. App frame

- Top bar (48 px): logo-mark (tide-gauge tile) + wordmark, center empty
  (calm), right cluster: add-widget, edit-mode toggle, settings, about.
  Bar hides on scroll-down / reveals on scroll-up (dashboard rarely
  scrolls on desktop; matters on mobile).

  **Built 2026-09-23.** This line was a spec with no code for five weeks.
  Rules that apply as built:

  - It reacts only to movement past an 8 px slop, and it is always shown
    within its own height of the top.
  - It **never hides while it is in use**:
    - in edit mode (the strip under it is sticky at the bar's height, and its
      Done button is how edit mode ends);
    - while the drawer or the shortcuts sheet is open;
    - while focus is inside it. A keyboard user must not tab into a bar they
      cannot see (WCAG 2.4.11), and `html` carries
      `scroll-padding-top: var(--tp-bar-h)` for the same reason.
  - It hides with `transform` only, so the grid's geometry and the detail
    overlay's FLIP never see it move.
  - The in-app reduced-motion setting drops the transition, not just the OS
    one.

  `TpTopBar.svelte.test.ts` drives a real scroll for each rule.

  The bar's content sits on the deck's rail — the same `--tp-deck-max` and
  `--tp-page-pad` as `main` — so the brand and the grid share a left edge at
  every width. `e2e/top-bar.e2e.ts` measures it, and doc 12 §2a records why it
  did not until then.
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

**What the host actually computes is broader, and it is the rule six weeks of
widgets were tuned against** (recorded 2026-09-29): `TpWidgetHost.svelte`
gives **L** whenever `w >= 4 || h >= 4`, so 4×1, 4×2 and 2×4 are L too, not
M. rss and markets read `size.tier === 'L'` as "roomy" and were checked on
screen at those sizes. The doc follows the code here rather than the reverse;
whether to narrow the host's rule to the one above was left for Week 8's
visual pass, where every widget could be looked at together. **Decided in Week
8: the host's rule stands**, and the L line above is read as it. Narrowing it
would take 4×1, 4×2 and 2×4 back to M under fifteen widgets tuned against
them, for a definition nothing else depends on. What the pass did settle is
the corollary: a layout that needs a particular *shape* keys on `size.w` /
`size.h`, never on the tier — as quote and weather do, as music and media do,
and as the clock's date line now does (doc 08 §5).

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
- The page reserves its scrollbar gutter (doc 06 §5.4), so a fixed surface
  — the drawer, the detail panel and its full-screen sheet, the dialogs, the
  coach — sizes itself with `100%`, never `100vw`. `100vw` includes the
  scrollbar, so a sheet sized with it ran 15 px under the page's scrollbar on
  Windows, where its close button sits. (2026-10-06, `e2e/scrollbars`.)

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
  instead). Built in Week 4b as `ui/TpRateLimitToast.svelte`
  over `stores/toast.svelte.ts`, once `currency` gave the 429 path a widget
  that could reach it. **Week 7 gave it a second kind** and a new name,
  `ui/TpToast.svelte`: a `notice` carrying its own words, for the music
  player's "skipped" and "stopped" (doc 09 §2). Those are global in the sense
  this bullet means — the player outlives every surface that could say them,
  so a skip can happen with neither tile nor detail on screen. The text is a
  thunk resolved at render, so it follows a locale switch. The slot still
  replaces rather than queues: a 429 can take it from a player notice inside
  four seconds and the reverse, and the track's own mark in the library says
  what happened either way. The toast lives in the `(app)` layout, so a notice
  raised while the reader is on `/about` or `/legal/*` is not shown. **No queue** — the doc 17 §5 throttle already allows one
  notice a minute, so “max 1 visible” is a replace rather than a policy about
  what to drop, and the four seconds are asserted to be shorter than that
  window so two can never overlap. `TpUpdateToast` keeps the root layout and
  its own slot: a service-worker update is not transient and has no timer.
  **`TpBotCheck`'s notice (2026-09-23)** borrows the same block for the one
  other global event a reader can meet: the Turnstile check could not finish
  (doc 15 §3). It stays until a retry succeeds rather than timing out, because
  live data is paused until it does.

## 8. Keyboard & a11y

- Global: `/` focuses widget-search-in-drawer? no — v1 keeps global keys
  minimal: `e` toggles edit, `Esc` closes topmost layer, `?` opens a
  shortcuts sheet. Media keys via Media Session (doc 09 §2).
- Detail panel = `role="dialog"` with focus trap + return-focus to tile.
  **The trap was built in Week 7b** (`ui/dialog-keys.ts`). Until then this line
  promised it, while Tab walked out of the panel into the deck behind the scrim.
  - Tab and Shift+Tab now wrap within the panel, and come back in from outside.
  - **Escape is the browser's while something inside is full screen**, and for
    500 ms after it leaves. Chrome swallows that Escape; engines that pass it
    on would otherwise close the detail too. The layers underneath still never
    see it.
- **The video player's keys** (doc 09 §3): Space or K, ← →, ↑ ↓, M, F and C. They
  work where the player has focus, which it takes when a video loads.
  - A key the player answers stops there.
  - A key a control already answers is left to it.
  - Escape and modified keys pass on.
  - The shortcuts sheet lists them under "In a video".
- Tiles are `section` landmarks labeled by widget title + instance name.
- **Every overlay scrolls inside itself** (WCAG 1.4.10). An overlay is
  `position: fixed`, so the page cannot scroll to anything it cannot show, and
  at 400 % zoom — 320 × 256 CSS px — the gate, the bug dialog and the
  shortcuts sheet were taller than the screen. Until 2026-10-06 the gate's
  Accept button could not be reached at that size. The dialogs cap themselves
  at the screen's height minus their margin and scroll. The gate scrolls as a
  whole, and centres its panel with auto margins, so a panel too tall to centre
  starts at the top instead of overflowing both ends. The detail's body and
  the drawer set `overscroll-behavior: contain`: a wheel at the end of either
  stops there rather than scrolling the deck behind the scrim.
  (`e2e/overlays`, each test red on the parent.)
- **Targets: 40 px in the chrome, the dialogs and every detail; 24 px inside a
  tile** — the owner's Week 8 call (doc 23), WCAG 2.2's 2.5.8 floor for controls
  packed into a 2 × 2 tile. One token carries it: `--tp-target` is 40 px on the
  root and 24 px on a tile host, and a control a tile and a detail share sizes
  itself from it. A label that activates its control counts as the target; a
  link inside running text is exempt, as 2.5.8 exempts it. Visible
  `:focus-visible` ring (beacon, 2 px offset).

  **Week 8 found the rule had never been held.** The brand link was 23 px tall,
  the edit strip's Done 24, the drawer's Add buttons 32, the Settings swatches
  24, its select 18 — the browser's own — and its actions 36; the bot check's
  retry, the coach's dismissal and the bug dialog's actions 32–36; the gate's
  links 23. Across the fifteen details there were about fifty more, from a
  16 px slider to 28 px row buttons. All of them meet it now, and
  `e2e/a11y`'s `expectTargets` fails any control outside a tile under 40 × 40.
  Inside a tile, axe's target-size rule holds 24 px — which is how the
  calculator's 17–19 px keys at three rows were found (doc 07 §3).
- **A field shows where it begins** (WCAG 1.4.11): text fields, selects and
  text areas are edged in `--color-field`, 3:1 on every surface, where the
  ink-700 hairline they had was 1.3:1 and was all there was. Containers keep
  the hairline; a button is found by its words.
- Contrast: **swept in Week 8, every token in both themes** (doc 12 §2's
  table). First measured 2026-08-28, when `widgets/toolbox/color.ts` gave the
  suite something to measure with: `fg` on `ink-900` 15.35:1, `fg-mute` 7.16:1
  — better than the 11.9 and 5.1 this line had asserted — and `fg-dim` 3.51:1,
  AA for large text only, while it set the notes updated-ago line, the clock's
  zone deltas and the calendar's lunar days at `--text-2xs`. That test checked
  colours it had typed itself, so it could never have failed on a token, and
  the light theme had never been measured at all: its beacon and focus ring
  were 1.81:1 on white and the gate's Accept button 1.60:1.
  `ui/contrast.svelte.test.ts` now measures the real stylesheet in the browser,
  for both themes and any accent, and was red on 45 cases before the fix.
  `fg-dim` is #738292 dark (4.62:1 at worst) and #616E77 light (4.65:1).

  A second finding for the same audit, recorded 2026-08-28: **tile controls are
  below the 40 px target above.** The todo tile has shipped 36, 32 and 28 px
  controls since Week 2 and the toolbox tile follows it at 28 px, because three
  40 px tabs plus a panel do not fit a 2×2 tile. **Decided in Week 8: a tile
  exception at WCAG's 24 px** (the targets line above), which both tiles meet.

  **The rest of the Week 8 sweep** (`e2e/a11y`, axe-core at WCAG 2.2 A and AA)
  found, besides contrast and targets: the calendar's days of the neighbouring
  months, in tile and detail, drawn in the disabled grey (2.0:1) — they are
  dates, read, so they are fg-dim now, and a selected day's lunar date moves to
  fg-mute on its wash; a loading skeleton named with `aria-label` on a bare
  `div`, which a name cannot attach to (`role="status"` now); the bug report's
  text area and the timer's add-preset button, with no name at all.
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

A choice group (`role="group"`) is named by **its own row's label**, never by
its section's heading, and a swatch by its colour's name, never its hex. Until
2026-10-06 the theme and motion groups were both labelled by the Appearance
heading, so a screen reader announced two groups called "Appearance", and the
swatches were read out as six hex digits.

| # | Section | Contents | Lands |
|---|---------|----------|-------|
| 1 | Ngôn ngữ / Language | vi \| en segmented control; changing it reloads (doc 14 §1) | Week 1 |
| 2 | Giao diện / Appearance | theme (dark \| light \| system), accent swatches + custom, reduced motion (system \| on \| off), scrollbars (shown \| hidden, doc 12 §9 — added Week 8) | Week 1 |
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

**The breaker rows did not, and that was a deliberate deferral to Week 5.** They
need `GET /api/_health`, which doc 11 §9 gates behind `env.DEV_DASH_TOKEN` — a
secret, and secrets are not declared in `wrangler.jsonc`. Typing one means
`wrangler types` reading a gitignored `.dev.vars`, so the committed
`worker-configuration.d.ts` would differ between a developer's checkout and CI
and `wrangler types --check` would fail on one of them. That is a real problem
with a real answer and it was not a Week 3 problem: doc 23 puts the quota
telemetry watch at Week 5, which is when a breaker table first has anything to
say. Recorded here rather than left as a gap in a numbered list.

**The typing half is resolved** — on the second attempt. The first, 2026-09-01,
declared the three secrets by hand in `src/worker-env.d.ts`, which kept the
committed file stable but left `--check` reading a developer's `.dev.vars`; it
was green only because nobody had one yet. Since 2026-09-23 `pnpm gen` generates
them from the committed `.dev.vars.example`, and doc 11 §9 carries the
mechanism and the measurement. What the deferral got right is that this was
never only the health endpoint's problem — it blocked every `/api/stock/*` route
the same way, so Week 5 could not have started anywhere else.

**The token half is settled (2026-09-23), and not the way it was proposed.**
The question was how a client that renders breaker state holds a secret that
doc 11 §9 keeps "absent in docs/UI". The proposal on the table was
`?debug=1&health=<token>`, stored nowhere. It stores it nowhere, and the rows
are built that way — but **not in the query string**, which turned out to be
three places at once:

- the Worker's invocation logs, which record the request URL;
- browser history;
- the page the analytics beacon runs beside (doc 15 §2).

What ships instead:

- `?debug=1` (or `tp.settings.v1.debug`) reveals the section, as before.
- The breaker rows sit behind a password field.
- The token typed there lives in the panel component's state, is sent once as
  `Authorization: Bearer`, and goes when the page does. It never reaches
  `tp.settings.v1` (the three-key rule, and the wrong place for a secret),
  the URL, or `logEntry` — a bug report exports the ring buffer. The component
  test asserts all three.
- The read is a form submit, not an effect.
- A refusal says the token is wrong or unset rather than pretending the
  upstreams are fine.

`core/health.ts` is the transport, deliberately not `fetchEnvelope`, whose
retries and error vocabulary belong to the widgets.

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
