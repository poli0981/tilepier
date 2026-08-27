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

### Built 2026-08-27 — four deviations, each noted back per doc 19 §6

1. **The day/night tint is an equatorial terminator.** This section asks for
   "sunrise/sunset approximation (pure astronomy calc, no API)", which needs a
   latitude — and an IANA zone id carries no coordinates. The only ways to get
   one are a vendored several-KB table that goes stale every tzdata release, or
   a network call this section itself rules out. So `solarPhase()` computes the
   subsolar meridian (including the equation of time) and measures the zone's
   own meridian against it: under 90° day, 90–96° civil twilight, beyond that
   night. That is exactly right at the equator, and runs early at high
   latitudes — Reykjavík reads "night" at 23:00 in June. **The detail footer
   says so**, rather than letting the shading quietly lie. A latitude table is
   the upgrade path if this ever matters enough.

2. **Zone ids are canonicalised on the way in.** ECMA-402 and IANA disagree
   about which zone name is canonical, and engines disagree with each other.
   Measured on V8: `Intl.supportedValuesOf('timeZone')` returns `Asia/Saigon`,
   `Asia/Calcutta` and `Europe/Kiev`, and `resolvedOptions().timeZone`
   normalises `Asia/Ho_Chi_Minh` **to** `Asia/Saigon`. For a product built
   around Vietnamese identity (doc 12 §1) that is the one name it most needed
   right, wrong. A twelve-entry rename table in `service.ts` fixes the spelling
   at every entrance — platform, picker, storage — so what is stored and shown
   is the modern name, and a deck written by one browser does not grow a
   duplicate row when opened in another.

3. **The meeting-planner strip is an `<input type="range">.** "Drag a time
   marker" is what it does; being operable from the arrow keys and Home/End is
   what it also does, for free, which no amount of pointer-event code would
   have given.

4. **Twelve zones, not unlimited.** The list lives in `tp.layout.v1`, which doc
   05 §1 budgets under 100 KB. The tile shows the first three of them, which is
   what this section's "0–3 compact rows" already said.

`loading` and `empty` are unreachable for this widget and are not implemented:
the time needs no fetch, and a clock always has something to say. That is a
statement about this widget rather than about its doc 17 §3 class, and doc 06
§3 now covers both kinds.

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

### Built 2026-08-27 — five decisions, noted back per doc 19 §6

1. **The cue is synthesised, not a file.** This section says "audio cue
   (self-hosted, respects a mute setting)". A bundled sample means an asset to
   licence, a row in the doc 16 §5 register, and bytes in a budget — for two
   notes. `alert.ts` plays a perfect fifth on two `OscillatorNode`s: ships
   nothing, needs no attribution, and is self-hosted in the sense doc 15 §2
   cares about, in that no request leaves the page. It closes its
   `AudioContext` after the tail, because contexts are a few dozen per page and
   a pomodoro firing four times an hour would exhaust them over a working day.

2. **Running state lives in the tile's `settings`** (doc 05 §2), not in
   component state: `endsAt`, `pausedMs`, `phase`, `completed`. That is what
   makes the "finished while away" case above *possible* — a timer kept in
   memory has nothing to compare against when the machine wakes, because it did
   not survive to ask. It also rides along in the backup export at no cost.

3. **A late completion is silent.** The chime and the Notification fire only
   when the deadline is noticed within a minute of passing. Background tabs
   throttle timers to roughly one tick a minute, so a live-but-hidden tab is
   inside that window and a shut laptop is not. A chime ten minutes after the
   fact is noise; the tile shows "finished while away" instead.

4. **A session is credited to `endsAt`, not to when a tab noticed.** They are
   the same instant while the page is awake and very different when it is not.
   A focus block that ended at 23:50 and is seen at 08:00 belongs to the day it
   ended, or closing a laptop would quietly move yesterday's focus onto today's
   bar.

5. **The tile owns completion; the detail does not.** Both render from the same
   settings and show the same states, but if both advanced the phase the
   session would be logged twice. The tile is the component mounted whenever
   the deck is, including underneath an open detail overlay.

`loading` and `empty` are unreachable for this widget and are not implemented:
there is no fetch, and a timer always has a duration. `permission-needed` *is*
implemented, and is required, because the manifest declares
`permissions: ['notifications']` (doc 06 §3).

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

### Built 2026-08-27 — decisions and one correction

1. **`%` is postfix and means "divide by a hundred".** This section lists it in
   the scientific row, so it acts on the value in front of it. The other
   convention — `50 + 10%` meaning 55 — requires the operator to know what the
   expression *meant*, gets `50 × 10%` wrong under the same rule, and differs
   between calculator brands. One predictable meaning beats a clever one.

2. **Every conversion factor is an exact decimal, by choice of base unit.**
   Speed is based on km/h rather than m/s because m/s per km/h is five
   eighteenths and no decimal can hold it, while km/h per m/s is exactly 3.6.
   The imperial lengths are exact by definition (a foot *is* 0.3048 m). So a
   conversion rounds once, at the division, and never accumulates.

3. **Temperature has its own pair of affine functions**, written as
   `°X = °C × scale + offset` — the direction with exact constants, since
   Fahrenheit is 1.8 and 32 exactly where the inverse is five ninths. Every
   conversion goes through Celsius rather than composing the two, because
   composing them is where a sign or an offset goes missing.

4. **The state is module-level and session-only.** `calc` is
   `multiInstance: false` (doc 06 §7), so the tile and the detail share one
   store: typing in the tile and opening the panel shows the same expression.
   Nothing is persisted — a half-typed sum is not a preference, has no business
   in `tp.layout.v1`, and would ride along in every backup.

**A correction worth recording.** The first `divide` scaled the numerator by a
fixed number of decimal *places* and called that twelve significant digits. It
is not the same thing: `0.0125 ÷ 1609.344` came back with nine significant
digits rather than fourteen, and converting millimetres to miles and back lost
eight of them. The shift is now derived from the digit counts, so precision no
longer depends on where the result happens to sit on the number line. Found by
the converter's round-trip test, which is the reason to write a test that walks
every pair rather than three interesting ones.

`loading` is unreachable here. `empty` **is** reachable and is implemented —
the tape with nothing on it yet is genuinely empty, and is the one tier-1
widget so far where that state means something.

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

### Built 2026-08-27 — and two sanitiser findings worth the space

**`marked` has no `html: false`.** This section says "no raw HTML (marked
option `html: false` semantics via sanitizer allowlist)", and the parenthetical
is the operative half: no such option exists in marked 18. Raw HTML in a note's
source reaches the output intact, and the allowlist is the only thing standing
between it and the page. Which is what this section already said — but it is
worth stating without the hedge, because a reader could take the option name
for a belt to the allowlist's braces.

**Two ways the DOMPurify config was quietly wrong**, both caught by the doc 19
§3.6 corpus rather than by review:

1. `USE_PROFILES: { html: true }` alongside `ALLOWED_TAGS` does not narrow the
   allowlist to the intersection, as its name suggests — it *widens* it to the
   whole HTML profile. With it, `<form>` came through intact. It had been added
   as belt-and-braces and was doing the opposite, which is the most dangerous
   shape a sanitiser bug takes.
2. `ALLOWED_URI_REGEXP` is applied to **every** attribute value, not only to
   the ones carrying URLs. Tightening it therefore silently dropped
   `type="checkbox"` as an unsafe URI, and GFM task lists lost their boxes.
   `ADD_URI_SAFE_ATTR` exempts the four attributes here that hold no URL.

**One `{@html}` in the whole application**, in `lib/ui/TpMarkdown.svelte`, and
it takes markdown *source* rather than HTML. A component that accepted HTML
would be one careless call site away from rendering something unsanitised, and
the `// SAFETY:` comment CLAUDE.md rule 7 asks for would be attached to the
render rather than to the decision. `marked` and `dompurify` are loaded from
inside it on demand, so they form one lazy chunk shared by every consumer
instead of most of a tile's 40 KB budget (doc 20 §6) — measured: the notes tile
chunk is under 2 KB gz.

**The note title is derived from the body and stored.** A markdown note's first
line already is its title, and asking for it twice asks the user to keep two
things in sync; storing it is what lets the sidebar render a list without
loading every body, since doc 05 §3 indexes `notes` on `updatedAt` alone.

**Reloading the list and choosing what to edit are separate operations**, and
that separation was learned the hard way. A single `refresh()` that did both
overwrote the in-progress draft whenever it was still in flight: clicking "new
note" and typing immediately produced an empty textarea and an untitled row,
because the reload from the click landed after the first keystrokes. The list
is also updated optimistically as you type, since its rows show derived titles
and its search reads bodies — a list that only caught up after the 300 ms
debounce would fail to find a note you had just written the words into.

**The tile's fallback does not re-pin.** When the pinned note is gone the tile
shows the most recent one and says so, rather than silently rewriting its own
`settings` to point at a note the user never chose.

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

### Built 2026-08-27 — five decisions

1. **Reordering is by list, not by item.** This section says "Reorder via
   native drag within the detail only", and the schema decides which thing that
   can mean: doc 05 §3 gives `todoLists` an `order` field and `todos` none, and
   a shipped `version(1)` block cannot gain one (CLAUDE.md rule 10). Items sort
   by due date and then recency instead, which is the order a todo list wants
   to be read in anyway.

2. **The reorder control is a pair of arrow buttons, not HTML5 drag.** A drag
   handle works with a mouse and with nothing else; two buttons work from a
   keyboard, a screen reader and a phone. doc 13 §8's ≥ 40 px targets and
   keyboard-only pass both point the same way.

3. **The `today` filter includes what is already overdue.** Something due
   yesterday is more today's problem than tomorrow's, and a filter that hid it
   would be the one place the app quietly loses work.

4. **Deleting a list deletes its items, in one transaction.** This section
   rules out a soft delete for completing an item; deleting the list it lives
   in is not one either. Orphaned rows would be invisible, would never be
   cleaned up, and would ride along in every backup (doc 05 §6) forever.

5. **Clearing a due date deletes the field** rather than setting it to
   `undefined`. `exactOptionalPropertyTypes` (doc 20 §2) forbids the
   assignment, and deletion is the more honest of the two: a record with no
   `due` key is what "no date" means, and it is what an export then carries.

The tile distinguishes "there are no lists" from "the list you chose is gone" —
both are `empty` by doc 06 §3's taxonomy, but they are different sentences and
lead to different actions. The second does **not** silently adopt another list:
the user picked that one.

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
