# 09 · Widget Specs — Tier 3 (heavy)

## 1. `markets` — Crypto + US Stocks

### Data model (see doc 10 §4–5, doc 11 §5)

| Need | Source | Path |
|------|--------|------|
| Crypto quote + 24 h stats | Binance public | `/api/crypto/ticker` |
| Crypto candles | Binance klines | `/api/crypto/klines` |
| US stock quote | Finnhub `/quote` (free) | `/api/stock/quote` |
| US stock candles/series | Twelve Data `/time_series` | `/api/stock/series` |
| Symbol search | Finnhub `/search` (stocks) + static top-list (crypto) | `/api/stock/search` |

Finnhub free **does not** include `/stock/candle` (403) — the split above is
mandatory, not an optimization.

- **Watchlist:** ordered list in widget settings, default
  `[BTCUSDT, ETHUSDT, AAPL, MSFT]`, max 12 in v1 (quota model, doc 11 §7).
  Each entry `{ kind: 'crypto'|'stock', symbol, display }`.

  **Week 5a seeds the crypto half of that default and 5b restores the rest**,
  which is a deviation worth naming rather than hiding: `/api/stock/quote`
  lands in 5b, so seeding `AAPL` and `MSFT` now would put two permanently
  unanswerable rows on a tile whose whole job is to say what it knows. A stock
  row is rendered exactly like a delisted coin until then — the row model is
  already written for both kinds.
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
  (daily), MAX (stock daily via Twelve Data EOD depth). Watchlist manager
  with search-add. Stocks show a "delayed/cached — not for trading" footnote
  (doc 16 §4).
- **Degradation ladder (stocks):** Twelve Data quota breaker open →
  serve KV stale with badge → if none, Stooq EOD fallback (daily only,
  ranges 1D collapses to 1W) → if none, quote-only view with explanatory
  empty chart state. Never a spinner that hangs.
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

### Playback

- Single `HTMLAudioElement` app-wide (survives detail close; mini controls
  in the tile). Source: FSA → `getFile()` → object URL (revoke on track
  change); blob path → object URL from Dexie blob.
- **Media Session API:** metadata (title/artist/album/cover), handlers for
  play/pause/prev/next/seek → OS media keys + lockscreen.
- Queue model: current playlist or ad-hoc queue; shuffle (Fisher–Yates over
  remaining), repeat off/all/one. Position persisted (settings) every 10 s
  and on pause → resume-where-left on reload.
- **Tile:** cover, title/artist marquee-on-overflow, progress bar,
  prev/play/next; h≥2 adds queue-peek line.
- **Detail:** library table (virtualized ≥ 500 rows — simple windowing,
  no dep), search, sort, playlists CRUD (drag to reorder), now-playing pane
  with large cover. **Visualizer (Web Audio AnalyserNode) is the declared
  cut-line** — ship v1.0 without it if Week 7 runs hot (charter risk #2).
- **Edge cases:** file moved/deleted since scan → play error toast + mark
  track missing (don't auto-delete; Rescan reconciles); unsupported codec →
  skip-next with per-track error mark; autoplay policy → first play always
  from user gesture (never autoplay on load).

## 3. `media` — Local Video Player

- Scope: play local video files; deliberately thin next to `music`.
- **Ingestion:** per-session file open (FSA file picker or `<input>`);
  optional "remember this file" (FSA handle in Dexie) for up to 5 recents.
  No library scan, no blobs stored (video sizes).
- **Tile:** last-played poster frame (captured to canvas → dataURL in
  settings, ≤ 50 KB) + resume position; click → detail.
- **Detail:** `<video>` with custom controls skinned to tokens: play/seek/
  volume/speed (0.5–2×), PiP button (`requestPictureInPicture`), fullscreen,
  keyboard map (space, ←→ 5 s, ↑↓ volume, F, M). Subtitle support: sideload
  `.vtt` via file picker (`<track>`); `.srt` converted client-side
  (tiny internal converter).
- **Resume:** per-file position keyed by name+size hash in settings (cap 20).
- **Edge cases:** codec unsupported (browser matrix varies for mkv/hevc) →
  explicit "codec not supported by this browser" state with a hint, not a
  silent black box; PiP unavailable → hide button.
