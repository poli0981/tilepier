# Accessibility

TilePier is meant to work for everyone who can use a web browser: from the
keyboard alone, with a screen reader, zoomed in, with motion turned down, and in
a high-contrast colour scheme. This statement says what we aim for, what the app
does today, how it is tested, where it still falls short, and how to tell us
when it fails you.

Reviewed for version **1.3.0** on **2026-11-09**.

## Our goal

We aim for [WCAG 2.2](https://www.w3.org/TR/WCAG22/) **Level AA** across the
app at <https://tilepier.win>. This is a goal we test against, not a formal
claim of conformance: no outside audit has been done, and the gaps we know of
are listed under [Known limitations](#known-limitations).

An accessibility failure is a bug like any other, triaged by how much it stops
someone from doing (see [Severity](#severity)). An A or AA failure that blocks a
task blocks the next release.

## What TilePier does

### Keyboard

- Every control can be reached and used from the keyboard, in the order it
  appears on screen, with a visible focus ring.
- **Tiles can be arranged without dragging.** In edit mode each tile has an
  _Arrange_ button. It opens a panel whose buttons, or the arrow keys, move the
  tile; Shift with the arrow keys resizes it. The panel says where the tile is
  after each step, and a step with nowhere to go says so instead.
- Global keys: `e` toggles edit mode, `?` lists the shortcuts, and `Esc` closes
  the topmost layer, from a text field too. **The two single-character keys can
  be turned off** in Settings → Keyboard, which also has a button that opens the
  list of shortcuts. They never fire while you type in a field or a menu.
- Dialogs and panels take focus when they open, keep `Tab` inside, and give
  focus back to where it was when they close. Removing a tile moves focus to the
  next one.
- A "Skip to main content" link is the first stop on every page of the app.
- Lists you can reorder (to-dos, feeds, playlists, currencies, watchlists) have
  move-up and move-down buttons. A to-do list is renamed with `F2` or a
  double-click.
- The video player takes its keys (Space or K, the arrows, M, F, C) only while it
  has focus, and the calculator only while its keypad has focus.

### Screen readers

- Each tile is a region named after it, and its buttons carry the tile's name
  ("Open Weather detail", "Remove Clock from the deck"), so a list of buttons
  says which tile each one belongs to. When two tiles share a name, they are
  numbered.
- Entering and leaving edit mode, adding and removing a tile, every step of the
  Arrange panel, and short notices are announced through live regions that are
  on the page from the start.
- Every page has a main landmark and a heading.
- The page language follows your choice of English or Vietnamese. A feed's
  headlines, a quote shown in its other language and the names of the two
  languages carry their own language, so a screen reader reads each in the right
  voice.
- Charts are paired with a one-sentence summary of what they show. Sliders give
  their value in words: a time, a volume, a position out of a length.

### Seeing and reading

- Text meets 4.5:1 and controls and focus rings meet 3:1 against their
  background, in both the dark and the light theme and for every accent colour.
  A test paints the real colours and measures them.
- Targets are at least 40 × 40 px outside a tile and 24 × 24 px inside one.
- Every overlay scrolls inside itself, so the app reflows at 400 % zoom
  (320 CSS pixels wide).
- Colour is never the only signal: a stale tile says so in words, and a price
  change carries its sign.
- **Windows contrast themes** (forced colours) keep pressed and selected states,
  focus rings, colour swatches and status dots visible.
- Numbers you watch use tabular figures, so they do not jump as they change.

### Motion and time

- Reduced motion follows your system setting, or can be set in Settings →
  Appearance. With it on, animations become crossfades or stop, including the
  loading shimmer, the moving brand gauge and the map's flights.
- A notice stays up for four seconds, and for as long as the pointer or focus is
  on it.
- Video and audio never start on their own. Subtitles come from your own `.srt`
  or `.vtt` files; TilePier has no media of its own.

## How we test

Automated, on every pull request (the `ci` and `e2e` checks must pass to merge):

- **axe-core** with the WCAG 2.0, 2.1 and 2.2 A and AA rules over every
  surface: the consent screen, the deck with all fifteen widgets, edit mode,
  every dialog and panel, and settings, in the light theme, the dark theme and
  at 375 px. Every widget's detail and the prose pages are scanned in both
  themes nightly.
- A **contrast suite** that measures every colour token in both themes.
- Playwright checks for **target sizes**, **focus rings**, **forced colours** and
  a **keyboard journey** (arranging tiles, the shortcut setting, `Esc` in fields
  and dialogs, focus after removing a tile, the skip link).
- `svelte-check` fails on any compiler warning, which includes Svelte's
  accessibility checks, and a scan refuses an `aria-label` on an element with no
  role.

By hand, by the maintainer, before a release that changes the interface: the
keyboard alone with the mouse disconnected, and a screen reader over the deck
and at least one detail.

| Checked by hand                         | Browsers             | Last result                        |
| --------------------------------------- | -------------------- | ---------------------------------- |
| Keyboard only, mouse disconnected       | Edge, Firefox, Brave | No failures (1.2.0, November 2026) |
| Narrator on Windows                     | Edge, Firefox, Brave | No failures (1.2.0, November 2026) |
| VoiceOver / TalkBack                    | —                    | No failures (1.2.0, November 2026) |
| NVDA, JAWS                              | —                    | Not yet tested                     |
| Safari, Windows contrast themes by hand | —                    | Not yet tested                     |

The automated suite runs in Chromium only.

## Known limitations

- **Charts are pictures.** Each has a one-sentence summary, but there is no data
  table, and the tooltip with exact values needs a pointer. The figures a chart
  is drawn from are also shown as text on the tile or in the detail.
- **The map is a canvas.** Saved places are buttons on the map and a list in the
  detail, and a map that fails to load shows the place as text; the streets
  themselves are not described.
- **Text size follows zoom, not the browser's default font size.** The page sets
  its base size, so a larger default font in browser settings does not enlarge
  the text. Browser zoom does, up to 400 %.
- **The bot check is Cloudflare's.** Turnstile's frame belongs to a third party
  and is left out of our scans.
- **What you bring in is only as accessible as its source**: a feed's headlines,
  a video with no subtitles, the Markdown of a note.
- **Some links open a new tab** (a feed item's source, the issue form) without
  saying so first.
- **Arranging works on the layout you see.** The deck is stored once rather than
  per screen width, so a tile arranged on a narrow screen is placed for that
  screen; the same is true of dragging.
- Lighthouse has not yet been measured against the project's target of 95.

## Reporting a problem

Open an issue with the
[accessibility form](https://github.com/poli0981/tilepier/issues/new?template=accessibility.yml),
in English or Vietnamese. You do not need to know the cause. It helps to say:

- the page or widget, and what you were trying to do;
- what you expected, and what happened instead;
- your assistive technology and its version, your browser and its version, and
  your operating system.

If the issue form does not work for you, start a
[discussion](https://github.com/poli0981/tilepier/discussions) instead. Security
problems go through [SECURITY.md](SECURITY.md), never a public issue.

### How we respond

- A first reply within **72 hours**, with what happens next.
- A workaround, when there is one, while the fix is made.
- Word when the fix ships, and a request to confirm it if you are willing.

### Severity

Reports are triaged into the P0–P3 levels that every bug here uses
(`docs/internal/19-TESTING.md` §7):

| Level | For accessibility                                                              | Resolution                                                   |
| ----- | ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| P0    | The consent screen, the deck or the app shell cannot be used at all            | Fixed before anything else ships                             |
| P1    | An A or AA failure that blocks a task, such as a control with no keyboard path | Blocks the next release                                      |
| P2    | A failure with an equal alternative beside it                                  | The next minor release, or listed here as a known limitation |
| P3    | Cosmetic: wording, polish                                                      | When convenient                                              |

## Ownership

TilePier has one maintainer, poli0981, who triages accessibility reports, keeps
this statement current, and reviews it before each minor release. A change to
the interface follows the accessibility checklist in the
[pull request template](.github/pull_request_template.md), and
[CONTRIBUTING.md](CONTRIBUTING.md) says how changes are made.

## Feedback

Suggestions are welcome as an issue, a discussion or a pull request.
