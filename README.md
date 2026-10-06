# TilePier

A dashboard of small tools you arrange yourself: clock, lunar calendar,
weather, rates, markets, notes, your own music and video. What you put in it
stays on your device. Bilingual (Tiếng Việt and English), with no accounts,
no ads and no tracking cookies.

**[tilepier.win](https://tilepier.win)** · [Tiếng Việt](README.vi.md)

## What it is

- **Local-first.** The deck, your notes and lists, your settings and your music
  library live in your browser (localStorage and IndexedDB). Settings has a
  backup you can export and restore; nothing is uploaded.
- **Works offline.** It installs as an app, and what you have used keeps
  working without a connection. A tile that needs the network says how old its
  data is rather than going blank.
- **One small server.** Weather, rates, markets, feeds and place search go
  through a Cloudflare Worker that holds the API keys, caches answers and
  passes on only what the tile needs. Your browser talks to nothing else,
  except as described under privacy below.

## Widgets

| Widget           | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| Clock            | Local time, the date, and the zones you follow                  |
| Timer            | Countdown and pomodoro, with a record of your focus             |
| Calculator       | Four functions, exact decimals, and a unit converter            |
| Notes            | Markdown notes, kept on this device                             |
| Todo             | Lists and due dates, kept on this device                        |
| Calendar         | The month, with the Vietnamese lunar calendar on it             |
| Toolbox          | QR codes, passwords and colours, in one tile                    |
| Currency         | One pair, converted, at the day's rate                          |
| Weather          | One place, the next twelve hours, and the week                  |
| Quote of the day | One line a day, the same one for everybody                      |
| Feeds            | Headlines from the RSS and Atom feeds you follow, in one list   |
| Map              | Your places on a map, and the way to them elsewhere             |
| Markets          | A watchlist of coins and stocks, at a glance                    |
| Music            | Your own music, from a folder or from files you add             |
| Video            | A video from your device, with subtitles and picture-in-picture |

Each tile opens into a detail view with more of the same, and the deck adapts
from one column on a phone to twelve on a wide screen.

## Privacy, in short

TilePier's own code sets no cookie and sends nothing about you anywhere.
Two Cloudflare services see a visit:

- **Web Analytics**, which is cookieless and counts page views without
  identifying anyone.
- **Turnstile**, the bot check in front of the data endpoints. A passed check
  leaves Cloudflare's one security cookie, `cf_clearance`.

Nothing else is contacted until you show a map, whose tiles come from
OpenFreeMap directly; the map tile says so before its first request. The
[privacy page](https://tilepier.win/legal/privacy) has the whole account.

## Built with

SvelteKit and Svelte 5 on Cloudflare Workers, with gridstack, ECharts,
MapLibre with OpenFreeMap tiles, Dexie, Paraglide, marked with DOMPurify and
music-metadata. Data comes from Open-Meteo, ExchangeRate-API, Binance.US,
Finnhub, Twelve Data, Photon and Nominatim. Every source and every licence is
credited on [the licences page](https://tilepier.win/legal/licenses).

## Run it locally

You need Node 24 and pnpm 11 (corepack provides it).

```bash
corepack enable
pnpm install
pnpm dev
```

Most tiles work with no keys. The stock half of Markets needs Finnhub and
Twelve Data keys: copy `.dev.vars.example` to `.dev.vars` and fill them in.

```bash
pnpm verify      # everything CI runs: lint, dead code, i18n, tests, build, budgets
pnpm test:e2e    # the Playwright suite, against the built Worker
```

[CONTRIBUTING.md](CONTRIBUTING.md) explains how changes are made here.
[docs/self-hosting.md](docs/self-hosting.md) covers running your own copy.
Security reports go through [SECURITY.md](SECURITY.md), never a public issue.

## Licence

[GPL-3.0-only](LICENSE). The data sources and libraries keep their own
licences, listed in full on the licences page.
