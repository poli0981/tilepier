# 09 · Widget Specs — Tier 3 (heavy)

## 1. `markets` — Crypto + US Stocks

### Data model (see doc 10 §4–5, doc 11 §5)

| Need | Source | Path |
|------|--------|------|
| Crypto quote + 24 h stats | Binance.US public (doc 10 §4) | `/api/crypto/ticker` |
| Crypto candles | Binance.US klines | `/api/crypto/klines` |
| US stock quote | Finnhub `/quote` (free) | `/api/stock/quote` |
| US stock candles/series | Twelve Data `/time_series` | `/api/stock/series` |
| Symbol search | Finnhub `/search` (stocks) + static top-list (crypto) | `/api/stock/search` |

Finnhub free **does not** include `/stock/candle` (403) — the split above is
mandatory, not an optimization.

- **Watchlist:** ordered list in widget settings, default
  `[BTCUSDT, ETHUSDT, AAPL, MSFT]`, max 12 in v1 (quota model, doc 11 §5 — this said §7, which is rate limiting).
  Each entry `{ kind: 'crypto'|'stock', symbol, display }`.

  **Week 5a seeded the crypto half of that default and 5b restored the rest**
  (2026-09-23), with the endpoint that can answer for them: seeding `AAPL` and
  `MSFT` before `/api/stock/quote` existed would have put two permanently
  unanswerable rows on a tile whose whole job is to say what it knows. A reader
  who added the widget in between keeps the list they have — settings are per
  instance, and the default is only read for a bag with no list in it.
- **Tier S is unreachable**, because `min` is 2×2 and doc 13 §3's tier S is
  `w <= 2 && h <= 1`. Named here per doc 06 §3's single-widget N/A rule rather
  than left as a gap in the DoD: a watchlist is a list, and a list has no honest
  one-line rendering.
- **Tile:** watchlist rows — symbol, last price, 24 h (crypto) / day (stock)
  change % chip colored by sign (colors from tokens, color-blind-checked pair,
  doc 12 §4 — and the sign is placed by `Intl` *before* the colour is applied,
  so colour reinforces rather than carries), micro-sparkline at w≥3 from cached
  series (no extra fetch: reuse the series cache, downsampled).
- **Refresh:** 60 s while the tab is visible (scheduler pauses hidden);
  quotes only — series refresh on-demand in detail.
- **Detail:** symbol header (price, change, day range), **candlestick +
  volume** via ECharts (`candlestick` + `bar` on shared axis, dataZoom),
  range presets: 1D (crypto 5 m klines / stock 15 m intraday), 1W, 1M, 1Y
  (daily), ~~MAX (stock daily via Twelve Data EOD depth)~~ — cut for v1, Week
  5's one approved depth cut (doc 23 §Week 5). Watchlist manager
  with search-add. Stocks show a "delayed/cached — not for trading" footnote
  (doc 16 §4).
- **Degradation ladder (stocks):** Twelve Data quota breaker open →
  serve KV stale with badge → if none, quote-only view with explanatory
  empty chart state. Never a spinner that hangs. Between the intraday stop
  (720) and the daily one (780), 1D collapses to 1W: the detail shows the
  daily series with a note rather than an empty intraday chart.

  (Amended 2026-09-23. The ladder had a Stooq EOD rung between stale and
  quote-only. Stooq was dropped on 2026-09-23: its CSV endpoint has needed an API key since 2026-03, and it answers scripted clients with a JavaScript proof-of-work page — a bot check this project does not circumvent. The daily stale window is seven days, which covers
  most of what that rung was for.)
- **Formatting:** `Intl.NumberFormat` with per-asset precision (BTC 2 dp,
  sub-$1 alts 4–6 dp, stocks 2 dp); percent always signed. The precision is
  keyed off the **price** rather than off the symbol (`priceDigits`): the rule
  is about magnitude, and a hard-coded list of coins would be wrong the first
  week a new one is listed and wrong again for a stock trading under a dollar.
  `i18n/fmt.ts`'s `fmtPrice` is separate from `fmtRate` for the same reason —
  `fmtRate` is significant-digit based, which is right for a rate spanning
  0.000043 to 25 951 and renders a 62 910.53 price as "62,910.5".
- **Edge cases:** market closed (stock) → "as of close" timestamp; delisted
  symbol → row error chip with remove shortcut; symbol valid on Finnhub but
  missing on Twelve Data → quote-only mode for that symbol.

### The sparkline is a read, and absent is normal (2026-09-01)

"No extra fetch: reuse the series cache" is load-bearing rather than tidy. doc
11 §5's quota model says "series fetched only when a detail view opens (not for
tiles)", and a tile that subscribed to a series through `swr()` would revalidate
on its own 60 s cadence, once per watched symbol — which is the model's whole
long-tail risk arriving by the front door.

So the tile **peeks** `apiCache`: one Dexie read, no subscription, nothing in
the dedupe map, nothing for the scheduler to wake. Two consequences follow and
both are deliberate:

- **A sparkline is absent until the reader has opened that symbol's detail at
  least once.** That is an ordinary state and the row simply renders without
  one, the way it renders without a change figure upstream did not send.
- **A cached coin series older than six hours is not drawn**, even though
  `swr`'s own ceiling is seven days. Seven days is right for a payload that *is*
  the reading; it is wrong for one sitting beside a live price, where a week-old
  shape reads as this morning. Six hours is doc 11 §4's klines stale window —
  past it the endpoint would not serve those candles either. **A stock's window
  is a day** (2026-09-23), the intraday series' own stale window: its series
  goes quiet with the exchange, and six hours would blank every stock sparkline
  overnight while nothing it showed had changed.

The peek prefers the finest interval it finds and falls back through the
coarser ones, because the sparkline is about the shape of recent trading rather
than about a bucket size — requiring `5m` would make the feature depend on
which range the reader happened to click last.

It is drawn as an inline SVG polyline, not through ECharts: the chart module is
183 KB gz, and a tile is not a place to spend it.

### How a single row is allowed to fail (2026-09-01)

All three edge cases above degrade **per symbol**, and the doc 11 §2 envelope is
all-or-nothing. So a failed row has to be expressible *inside* `data`, or one
delisted coin fails the whole tile — which is what the payloads do:
`TpCryptoTickerPayload.quotes` is keyed by every **requested** symbol, with
`null` where upstream had no answer.

Keyed by *requested* rather than built from the response, and that is the part
worth stating: upstream simply omits a symbol it has nothing for, so an object
built from the response omits it too — leaving the tile unable to tell "no
answer" from "never asked". The row error chip is made of exactly that
distinction. `/api/crypto/ticker` additionally has to split a refused batch to
produce the case at all (doc 10 §4).

Inside a row that *does* exist, `change24h`, the day range and the volume are
`number | null` individually rather than defaulted. doc 08 §2 settled the same
question for the currency table and the sentence transfers whole: a 0.00 % is a
claim about the market, and a high equal to the low is a claim about the day.
A row with no usable **price**, though, is `null` outright — a quote without a
price is not a quote, and the tile has something to say about an absent row and
nothing to say about a price that is missing.

### Two sources on one tile (2026-09-23)

The stock half made the tile the first to read **two** quote sources at once —
the crypto set from Binance.US, the stock set from Finnhub — each under its own
data key, and that changed what a row and the tile can be.

- **A row has four states, not two.** `quoted`; `absent` (its source answered
  and had nothing — the delisted case, and the only one with the remove
  shortcut); `waiting` (its source has not answered — a skeleton bar at the
  width of the price it stands in for); `unread` (its source failed with
  nothing cached). Before 5b one request answered for every row, so a row could
  only be quoted or not, and "not" always meant delisted. With two sources the
  stock rows can be on their way, or failed, while the coins are on screen, and
  neither of those is "upstream had nothing for this symbol".
- **The tile's state comes from both sides** (`tileView`): the list as soon as
  either has quotes; the skeleton while neither has and one is still asking;
  after that the most telling failure — offline, then rate-limited, then
  error. A side the watchlist does not use is not consulted at all. **This
  fixed a 5a bug that could not yet be reached:** the tile read its status off
  the crypto handle, and a watchlist of only stocks has no crypto handle, so it
  would have held a skeleton for as long as it was open.
- **The host badge is the most worrying side's**, dated by that side — a badge
  is a claim about particular prices, and an age borrowed from the healthier
  side would understate it. A side with nothing on screen raises no badge; its
  rows already say so.
- **Two scheduler entries**, `<instanceId>` and `<instanceId>:stock`, both at
  doc 06 §7's 60 s. Two rather than one running both because the scheduler
  owns backoff per entry, and one entry would slow the coins down every time
  Finnhub had a bad minute.
- **"As of close" comes from the quote's own timestamp**, not from a market
  calendar: a stock whose last trade is more than 30 minutes old is marked
  "close" beside its price (`CLOSE_QUIET_MS`). A calendar is a holiday list
  somebody has to keep, and it would still be wrong about a halted stock.
  Finnhub stamps a quote with its last trade, which in session is seconds old
  for anything a watchlist would hold. Coins trade around the clock and are
  never marked.
- **The remove shortcut writes through `onUpdateSettings`**, and is absent
  where there is nowhere to write — the `/w/[id]` direct load has no host to
  hand the callback down, and a button that cannot do anything is worse than
  none.

### Two ranges over one interval (2026-09-23)

1M and 1Y are both daily candles, so they share one data key — doc 11 §4 keys a
series by symbol and interval only. **Through Week 5a each range still sent its
own `limit`**, so the key named two different responses: whichever range was
opened second read the first one's window out of `apiCache` as fresh and drew
it under its own label — a year captioned 1M, or a month captioned 1Y, until
the entry went stale. Found writing the stock detail, whose three daily ranges
share a key three ways; confirmed at runtime by a test that fails on the 5a
code ("BTC over 1M: … opened 135.00", a year's first candle).

The fix is the klines rule applied on the client too: **each interval is always
fetched at the deepest window any range asks of it** (1d → 365 for coins, 1day
→ 252 for stocks), and the range picker cuts its window out of that
(`windowOf`). The key is the request again, which is what `swr`'s
de-duplication assumes. It costs nothing upstream — the Worker holds one deep
series per interval whatever the window, and Twelve Data charges a credit per
call rather than per candle — and a few kilobytes on a 1M view.

### The stock detail (2026-09-23)

- **1D collapses to the week when intraday is refused.** The Worker answers 1D
  with `QUOTA_EXHAUSTED` when the intraday stop (720) has been reached and it
  has nothing stale; the detail then draws the daily week with a note, while
  the picker keeps showing 1D and the chart summary names the range actually
  drawn. The collapse is per symbol and per panel: the next opening asks again,
  for the price of one refused request that spends nothing. **Twelve Data's
  per-minute limit is not this rung** (2026-09-23): a spent minute answers
  `RATE_LIMITED` with the seconds left, and the chart area says "too many
  requests — waiting a moment" rather than collapsing a range the day has not
  refused (doc 11 §5).
- **Quote-only** is an empty series: a symbol Finnhub quotes and Twelve Data
  does not cover, or one the Worker would not spend a credit on because
  Finnhub had no quote for it (doc 11 §3). The header's price stands and the
  chart area says there is no chart for it. With the daily series refused too —
  the last rung — it says the day's allowance is spent and when it returns.
- **Footer:** doc 16 §4's disclaimer permanently, the "delayed/cached — not for
  trading" footnote above for a stock, and a credit line per payload actually drawn —
  Finnhub for the price and Twelve Data for the candles, or Binance.US once for a
  coin.
- **Search-add.** A kind selector beside the add box; for a stock the box
  searches `/api/stock/search` after 300 ms without typing and from the second
  character — a single letter matches half the exchange, and a one-letter ticker
  (`F`, `T`) is still added by typing it. The query goes up lower-cased, so
  "Apple" and "apple" are one edge entry and one key, and it is validated by
  the Worker's own rule (`stockSearchText`, shared) so the box never offers a
  search the Worker refuses. Results are buttons; one already on the watchlist
  is disabled and says so. Company names are text nodes (CLAUDE.md rule 7).
  A coin is never searched — its list is the bundled top-list.
  **With no network** (Week 8) the box says a search needs the network and asks
  nothing — doc 17 §3's search-dependent class, as the place search already
  did. Until then every failure read "search is unavailable right now", an
  upstream's problem, to a reader whose own connection was off.

## 2. `music` — Local Music Player

### Library ingestion (Spike S2 governs)

- **Path A — FSA (Chromium):** user picks a folder
  (`showDirectoryPicker`), handle persisted in Dexie `fsaHandles`.
  Scan walks the tree (audio extensions allowlist: mp3, m4a, flac, ogg,
  opus, wav), extracts tags via `music-metadata` in a **Web Worker**
  (main thread never parses), stores metadata in `tracks` (doc 05 §4),
  covers deduped by hash. Session start: `queryPermission({mode:'read'})`
  → if `prompt`, show a one-click "Re-link library" card (browser requires
  a user gesture for `requestPermission`). Rescan button diffs by
  path+size+mtime.
- **Path B — import (all browsers):** multi-file/folder `<input>` →
  metadata + audio blob into `trackBlobs`. Quota warning per doc 05 §7.
  Feature-detect chooses the default path; both can coexist.

### How a scan decides (Week 7a-1, spike S7 — doc 22 §S7)

`widgets/music/library.ts` (`scanFolder`, `importFiles`) and `tags.ts`, the
only module allowed to import music-metadata:

- **Resolves only once written.** Each file is one transaction — its cover,
  its bytes on path B, its row — and the promise settles after the last one.
  The spike's `ingest()` returned with its writes in flight, so a full disk
  surfaced nowhere; now a full disk stops an import where it is, keeps what
  came before, and says so.
- **A rescan diffs, it does not rewrite.** Same size and modification time:
  untouched, `addedAt` and all, and not parsed again. Changed: parsed again and
  updated in place, under the same id (doc 05 §4). Gone: marked `missing`,
  never deleted — and **only when the folder that held it was read**. A
  subfolder that cannot be listed is skipped and recorded; a root that cannot
  be listed throws before anything is marked, so an unplugged drive or a lapsed
  grant never turns the whole library "missing". A cancelled scan marks
  nothing. A track that comes back is unmarked.
- **What is not listed:** hidden entries (dot-folders, macOS `._` files, which
  carry audio extensions), and a file the parser finds no audio in at all.
  music-metadata only throws for the latter when it sniffs; a folder's files
  carry a MIME type guessed from their extension, which it trusts, so a text
  file called `fake.mp3` came back with an empty format — an empty format now
  counts as not-audio. A file whose tags merely fail to parse **is** listed,
  under its own name: broken tags often play.
- **Tags.** A missing value is `''`, rendered as "Unknown artist" in the
  reader's language; the spike wrote the Vietnamese `'không rõ'` into Dexie.
  The title falls back to the file name. Values are NFC-normalised, and a WAV
  file's RIFF INFO, which music-metadata reads as Latin-1 although the tools
  that write it write UTF-8, is read as UTF-8 when its bytes are valid UTF-8.
- **Cover.** The picture typed "Cover (front)", else the first (music-metadata's
  own `selectCover()` returns the first whatever it is, and an MP4 `covr` has
  no type); none above 1 MB. Stored once per image by SHA-256, and collected
  when no track points at it. Imported audio is never deleted automatically.
- **Duration.** Parsed with `duration: false`. With `true` a VBR MP3 with no
  Xing/Info/LAME header is read to its end to count frames; every other
  container gives a duration without it. That one file's duration comes from
  the player's `loadedmetadata`.
- **The worker** takes one file per request. One that hangs is answered
  "unreadable" after 20 s and the worker is replaced; a worker that fails on its
  own — its script would not load — stops the scan rather than filing every
  track as unreadable. Failures travel as a category, never as the parser's
  message, and nothing about a reader's files — name, path, title — is ever
  logged (doc 18).

### Playback

- Single `HTMLAudioElement` app-wide (survives detail close; mini controls
  in the tile).
- **A background tab plays on past a lapsed folder grant** (Week 7b-1, plan
  S23). Chrome revokes an "Allow this time" grant once a tab has sat in the
  background a while, and a `File` taken before that still reads: the owner
  checked it on production (doc 22 §S7).
  - While the grant holds, the player keeps the next twenty folder tracks'
    `File`s. These are references, not bytes.
  - A track is read from its held `File` only when a fresh read is refused,
    so an edited file is still read as it is now.
  - Past the held window, the tile asks for the grant again. Source: FSA → `getFile()` → object URL (revoke on track
  change); blob path → object URL from Dexie blob.
- **Media Session API:** metadata (title/artist/album/cover), handlers for
  play/pause/prev/next/seek → OS media keys + lockscreen. As built (Week 7):
  written only while the music player holds `core/playback`'s claim, so it
  never writes over the video player's session; cleared when the player
  stops, so a media key cannot start music for a tile that has left the deck.
  `seekbackward` and `seekforward` stay unset: iOS shows ±10 s buttons
  *instead of* previous and next while either exists. Every write goes
  through `core/media-session.ts`'s guards — older Safari throws for an
  action it does not know, and `setPositionState` throws for the `NaN`
  duration an element reports before its metadata. The artwork is the
  cover's object URL, one per cover and shared by an album's tracks; Firefox
  on Windows does not show `blob:` artwork, which is accepted.
- Queue model: current playlist or ad-hoc queue; shuffle (Fisher–Yates over
  remaining), repeat off/all/one. Position persisted (settings) every 10 s
  and on pause → resume-where-left on reload.
- **Tile:** cover, title/artist marquee-on-overflow, progress bar,
  prev/play/next; h≥2 adds queue-peek line.
- **Detail:** library table (virtualized — always, since Week 7, through
  `core/windowing.ts`: simple windowing,
  no dep), search, sort, playlists CRUD (~~drag to reorder~~ up and down
  buttons — see Playlists), now-playing pane
  with large cover, and under it the next eight songs in play order
  ("coming up", Week 7) — choosing one plays it and keeps the queue, where a
  library row starts a new one.
- **Playlists** (Week 7). Made in the detail and chosen as chips; the chosen
  one opens below with its songs, and is what the library's "+" adds to — with
  none chosen there is no "+". Reordered with **up and down buttons, not
  drag**: they work from a keyboard as they are, the currency detail already
  uses them, and drag would bring a library the budget has to carry. Deleting
  asks first, inline, and says the songs stay; it never touches them. A song
  since removed from the library keeps its place, greyed, until the reader
  takes it off, and the player skips it. **Written through, one row per
  action** — not through doc 04 §6's 300 ms writer, which keeps only the last
  record in its window and would drop one of two quick edits to two playlists;
  nothing here is keystroke-level (a rename is kept on Enter or on leaving the
  field). The in-memory list changes before the write, so two presses a few
  milliseconds apart both count. ~~**Visualizer (Web Audio AnalyserNode) is the declared
  cut-line** — ship v1.0 without it if Week 7 runs hot (charter risk #2).~~
  **Cut 2026-09-29**, before Week 7 started (doc 23): the week measured
  5.55×, and `createMediaElementSource` binds the one audio element to an
  AudioContext for good — every sound the player makes would route through a
  graph that starts suspended. It is in the v1.x parking lot.
- **Edge cases:** file moved/deleted since scan → play error toast + mark
  track missing (don't auto-delete; Rescan reconciles); unsupported codec →
  skip-next with per-track error mark; autoplay policy → first play always
  from user gesture (never autoplay on load). Imported audio a replacing
  restore left without tracks → shown in the detail with its size, deleted
  only when the reader asks (doc 05 §6, Week 7 plan S25).

## 3. `media` — Local Video Player

- Scope: play local video files; deliberately thin next to `music`.
- **Ingestion:** per-session file open (FSA file picker or `<input>`);
  ~~optional "remember this file"~~ every file opened through the FSA picker
  remembered (the owner's decision, 2026-09-29; FSA handle in Dexie) for up
  to 5 recents, each forgettable. No library scan, no blobs stored (video
  sizes).
- **Tile:** last-played poster frame (captured to canvas → ~~dataURL in
  settings~~ a JPEG `Blob` in the `playback` table, ≤ 50 KB) + resume
  position; click → detail.
- **Detail:** `<video>` with custom controls skinned to tokens: play/seek/
  volume/speed (0.5–2×), PiP button (`requestPictureInPicture`), fullscreen,
  keyboard map (space, ←→ 5 s, ↑↓ volume, F, M). Subtitle support: sideload
  `.vtt` via file picker (`<track>`); `.srt` converted client-side
  (tiny internal converter).
- **Resume:** per-file position keyed by name+size hash ~~in settings~~ in
  the `playback` table (Week 7 plan Q1, doc 05 §3) (cap 20).
- **Edge cases:** codec unsupported (browser matrix varies for mkv/hevc) →
  explicit "codec not supported by this browser" state with a hint, not a
  silent black box; PiP unavailable → hide button.

### As built (Week 7b)

- **Opening.** The File System Access picker where the browser has one (Chrome,
  Edge), which keeps a handle so the file is read again on every mount. An
  `<input accept="video/*,.mkv">` everywhere else, Brave included, since it
  ships the API switched off. From an empty tile it takes one click: the picker
  runs in the click, and the detail that opens plays the file.
- **One `<video>`, in the detail.** Picture-in-picture ends when the detail
  closes (owner decision Q2). The tile never holds an element. What the player
  reports goes to a module store the tile reads (`widgets/media/store`).
- **Never a black box** (doc 17 §4a):
  - a format this browser does not play says so, and names the formats that
    play almost everywhere;
  - a local file that fails to read or decode is read once more, then says it
    changed or moved;
  - a file with sound and no picture plays, and says so.
- **One sound at a time** (`core/playback`). The video takes the sound when it
  starts playing, not before `play()`, so a file this browser cannot play never
  pauses the music. The music player taking it back pauses the video.
- **The OS's keys** (`core/media-session`):
  - the Media Session carries the file's name and answers play, pause, ±10 s
    skips and seek;
  - previous and next stay unset, which on iOS is what brings up the skips;
  - the scrubber runs at the speed that plays.
- **Controls** are drawn in tokens:
  - the seek bar shared with music (`ui/TpSeekBar`);
  - play, pause, mute and volume;
  - picture-in-picture, full screen and subtitles;
  - speed from 0.5× to 2×.
- **Keys** (Week 7 plan S16). The video takes focus when it loads, so they work
  without a click: Space or K plays, ← → move five seconds, ↑ ↓ change the
  volume, M mutes, F goes full screen, C shows or hides subtitles.
  - A key the player answers stops there, so Space does not scroll the detail.
  - A key a control answers is left to it: Space on a button, the arrows on a
    range.
  - Modified keys and Escape pass on.
  - The shortcuts sheet lists them.
- **Picture-in-picture** only where `document.pictureInPictureEnabled` says so,
  and only for a video with a picture. It is ended when the player goes.
- **Full screen** on the player's box, so the controls come along. An iPhone
  has no element full screen, so there `webkitEnterFullscreen` hands the video
  to Safari's player. Escape in full screen stays the browser's (doc 13 §8).
- **Resume** (`widgets/media/resume`). A video picks up where it was left,
  past its first five seconds and short of its last five, and "Start over" is
  one press. One watched to the end starts at the start next time.
  - Where it is gets written every ten seconds of play, and at once on a
    pause, a seek, a hidden or closing page, and when the player goes — read
    before the element lets go of the file (Week 7 plan §3.1).
  - The key is the name and size, hashed — never the content, which would take
    longer to read than the film takes to open. Two files alike in both share a
    place. With no `crypto.subtle` (plain http) nothing is kept.
  - The volume and mute are the reader's, one row for every video. Speed goes
    back to 1× with each file.
- **After a reload** the tile shows the last video worth coming back to,
  with its still, and so does the detail with nothing open — a reload with the
  detail open lands on `/w/media`, not on the deck. The tile's `loading` and
  `error` are that read, and an error still offers a video.
  - One opened through the picker opens again from its handle: the browser
    asks for the grant again first, in the click. A refusal, or a file that
    has moved, is said on the tile, and the next press picks instead.
  - Any other — from the `<input>`, as in Brave and Firefox — is picked
    again, and the same file finds its place by its name and size.
- **Recents** (Week 7b-4, `recents.ts`, `TpMediaRecents`). Every video
  opened through the picker is remembered once it has loaded: the newest five,
  in `fsaHandles` beside music's library folder, which nothing here touches.
  The detail with nothing open lists them, each with its still and where it
  was left.
  - Opening one asks the browser first, in the click. A refusal or a missing
    file is said beside the row, which keeps its Forget.
  - Forget takes the video's recent, its place and its still in one
    transaction; Forget all takes every video's, and keeps the volume.
  - A handle is a way back to the file, never the file (the privacy page
    says so).
- **Stills** (Week 7b-4, `poster.ts`). The frame the reader stopped on:
  drawn on every pause and when the player goes, but not at the end (its last
  frame is often black) and not mid-seek.
  - At most 320 px wide; JPEG at 0.7, then 0.55, then 0.4, until it fits in
    50 KB, else none. In the `playback` table beside the place, and gone
    when the place is.
  - Drawn synchronously, so the teardown draws before the element lets go of
    the file; the encode and the write come after.
  - Shown on the tile and in the recents, and given to the lock screen as
    the Media Session's artwork.
- **Subtitles** (Week 7b-3; `subtitles.ts`, `track.svelte.ts`). The
  captions button asks for a `.srt` or `.vtt` — in the folder the video came
  from, since the two pickers share an `id` — and shows it; after that it
  shows and hides them, as C does.
  - The file is read as text (doc 14 §6), SubRip is converted to WebVTT, and
    the result goes to the element as a `blob:` `<track>`, which `media-src`
    already allows. Its language comes from the file name (`Phim.vi.srt` is
    `vi`, anything else `und`), its label is the file name.
  - The browser draws the cues, so the reader's own caption settings apply:
    nothing styles `::cue`. Cue text is never HTML on the page (doc 15 §4).
  - A file with nothing to show says so under the video, and the video plays
    on. One over 2 MB is not read: that is a video picked by mistake.
  - None for sound alone. Picture-in-picture shows them where the browser
    does (Safari); Chrome's window does not.
  - Not kept: a file opened again starts without them.
- `TpVideoController` holds a video's state and adds its own listeners.
  `TpMediaPlayer` only draws it, which keeps the component under doc 20 §3's
  size.
