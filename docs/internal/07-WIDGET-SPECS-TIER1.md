# 07 · Widget Specs — Tier 1 (pure client)

No network, no proxy, no permissions except where noted. Build order within
tier: clock → timer → calc → notes → todo → calendar → toolbox.

## 1. `clock` — Clock & World Clock

- **Tile:** local time (huge tabular numerals), date line with lunar date
  underneath when locale=vi (e.g. `T7 30/08 · 08/07 Bính Ngọ`). Settings:
  24 h (defaults from app), show seconds, extra zones (0–3 shown as compact
  rows at h≥2).
- **Detail:** world-clock board — user's zone hero + grid of added zones
  (IANA picker with search), day/night tint per zone computed from
  sunrise/sunset approximation (pure astronomy calc, no API), time-difference
  ruler ("Tokyo +2h"), meeting-planner strip: drag a time marker, all zones
  update. No chart lib — SVG + CSS only.
- **Timing:** display interval 1 s while visible; recompute from `Date.now()`
  on visibility return. `Intl.DateTimeFormat` per zone, memoized per
  zone+format.
- **Edge cases:** DST transitions (always derive from Intl, never offset
  math); invalid stored zone → drop + warn.

## 2. `timer` — Countdown & Pomodoro

- **Tile:** two modes via settings — countdown (ring progress + mm:ss) or
  pomodoro (session ring, state chip Focus/Break, streak dots for today).
- **Detail:** pomodoro config (focus/break/long-break durations, sessions per
  cycle), countdown presets (editable), and history: last 14 days of focus
  minutes as an inline SVG bar sparkline (sessions logged to Dexie
  `events`-style table? → no: own table not needed, store in
  `todoLists`-adjacent? → **decision:** log to `apiCache`-style table is
  wrong; add Dexie table `focusSessions:'id, dateKey'` in schema v1).
- **Timing correctness:** deadline-based (`endsAt` timestamp), not tick
  counting — a throttled tab still ends on time. Completion fires a
  Notification (permission requested on first enable, `permission-needed`
  card otherwise) + audio cue (self-hosted, respects a mute setting).
- **Edge cases:** system sleep past `endsAt` → on wake show "finished while
  away" state, don't auto-start the next pomodoro.

## 3. `calc` — Calculator & Unit Converter

- **Tile:** 4-op calculator with keyboard input when focused; result line
  shows thousands separators per locale.
- **Detail:** tape history (session-only, copy row), scientific row
  (%, √, x², 1/x, ±), and the converter: categories length/mass/temp/
  data/area/volume/speed/time. Conversion factors are a static table;
  temperature is the only affine case — unit test it.
- **Implementation:** shunting-yard on decimal-safe integer math
  (scale by 10^n, cap 12 significant digits) — no float chaining, no
  `eval`, no mathjs dependency (bundle cost).
- **Edge cases:** divide-by-zero → `Error` state inline; overflow → exponent
  display.

## 4. `notes` — Markdown Notes

- **Tile:** pinned note (per-instance setting: which note) rendered as
  markdown preview, edit-in-place plain textarea on click; autosave 300 ms
  debounce (doc 04 §6). Footer: updated-ago.
- **Detail:** two-pane editor — left textarea (monospace), right preview
  (`marked` → `DOMPurify.sanitize` → `{@html}` — sanitize is non-negotiable,
  doc 15 §4). Note list sidebar: search (title+body substring), pin, delete
  (confirm), new. Supported markdown: CommonMark + GFM tables/task lists;
  no raw HTML (marked option `html: false` semantics via sanitizer allowlist).
- **Edge cases:** deleting the tile-pinned note → tile falls back to most
  recent; very large note (>100 KB) → preview virtualization not needed v1,
  but debounce preview render to 500 ms above 20 KB.

## 5. `todo` — Todo Lists

- **Tile:** one list (per-instance setting), add-input on top, unchecked
  first, checked collapse under "done (n)". Due dates show relative chips;
  overdue = warning color.
- **Detail:** all lists (create/rename/reorder/delete-with-confirm), filters
  (today / upcoming / no date / done), bulk clear-done. Reorder via native
  drag within the detail only (tile is read/check/add only).
- **Data:** `todos` + `todoLists` (doc 05). Completing sets `done=true`
  and `updatedAt`; no soft-delete.
- **Edge cases:** list deleted while a tile points to it → tile `empty`
  state with "choose list".

## 6. `calendar` — Calendar & Vietnamese Lunar

- **Tile:** current month mini-grid; today ringed; event dots; when
  locale=vi each cell shows the lunar day in small type, month boundaries
  (mùng 1, rằm) accented. Header: solar + lunar month labels.
- **Detail:** month view with event CRUD (title + optional note, all-day
  only in v1), agenda list for selected day, and a lunar panel: solar↔lunar
  converter, Can-Chi year/month/day, upcoming VN observances (Tết, Giỗ tổ
  Hùng Vương, rằm tháng Giêng/Bảy, Trung thu …) computed from the lunar
  module — static rule table, not an API.
- **Lunar engine:** port of the Hồ Ngọc Đức algorithm from QuoteAtlas into
  `lib/lunar/` with the existing test vectors carried over + new edge tests
  (leap-month years, 29/30-day months, 1900–2100 range guard).
- **Edge cases:** timezone is fixed to Asia/Ho_Chi_Minh for lunar
  computation regardless of viewer zone (correctness of VN calendar), with
  a note in the detail footer.

## 7. `toolbox` — QR · Password · Color

Three tabs in one widget (charter decision 2026-07-19).

- **QR:** text/URL → QR canvas, size + error-correction options, download
  PNG / copy image. Implementation: small vendored QR encoder (MIT) — no
  network, evaluate `qrcode` npm vs a lighter port at build (bundle < 15 KB).
- **Password:** length 8–64, char-class toggles, ambiguous-char filter,
  entropy readout (bits), generate via `crypto.getRandomValues` with
  rejection sampling (no modulo bias). Copy with auto-clear of the copied
  indicator; never store generated values anywhere.
- **Color:** picker (native `<input type=color>` + hex/rgb/hsl fields),
  contrast checker against a second color with WCAG AA/AAA verdicts,
  5-step tint/shade ramp, copy any format. Recent colors kept in the tile
  `settings` (max 8).
- **Tile view:** shows the last-used tab in compact form; detail shows all
  three full-width.
