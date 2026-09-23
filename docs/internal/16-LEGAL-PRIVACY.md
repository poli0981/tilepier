# 16 · Legal, Privacy & Licensing

## 1. Project licensing

- **Code:** GPL-3.0-only. `LICENSE` file = verbatim GNU text (fetch from
  gnu.org at repo init; do not paraphrase). SPDX headers optional; a
  `REUSE`-style pass is a v1.x nicety, not a gate.
- Rationale: portfolio consistency; every dependency in doc 02 is
  MIT/BSD/Apache-2.0/ISC → GPL-3.0-compatible. AGPL considered and
  declined (charter decision; plain GPL matches the rest of the portfolio
  and the Worker is a thin cache, not the product's value).
- Contributions: inbound = outbound (GPL-3.0). No CLA. DCO sign-off
  encouraged in CONTRIBUTING, not enforced by bot in v1.
- Bundled quote dataset: only entries that are CC0/public-domain/owned —
  **re-audit each entry** before bundling (carryover task from QuoteAtlas);
  dataset licensed CC0 where owned, with a `DATA-LICENSE` note.

## 2. Legal gate (QuoteAtlas pattern)

- First visit: blocking full-screen gate before the dashboard renders
  (SSR-rendered so it appears pre-JS). Content: one-paragraph summary +
  links to `/legal/terms`, `/legal/privacy`, `/legal/licenses`, `/about` +
  language toggle + single "Tôi đồng ý / I agree" button.
  `/about` added 2026-08-19: doc 13 §11 says the gate should reach it so a
  first-time visitor can find out what they are agreeing to *before* agreeing,
  and this list was the only thing stopping that.
- Acceptance stored in `tp.legal.v1` (doc 05 §2) with `LEGAL_VERSION`
  constant. Bumping the constant (material changes only) re-gates with a
  "what changed" line.
- Gate must be keyboard-accessible and not dismissible by DOM deletion
  alone (the deck mounts only after the acceptance flag exists — the gate is
  a real gate in code, not an overlay).

**That parenthesis was false until 2026-09-23.** It said "the app store
hydrates only after acceptance", and nothing did that. `hooks.client.ts`
hydrates the settings and deck stores on every load — the deck has to, because
a bug report filed from `/settings` needs it (doc 18 §2). The deck page then
mounted the grid and every widget under the hidden `.tp-app`. The gate was CSS
alone, and a networked tile was free to fetch behind it:
`e2e/legal-gate.e2e.ts` found a currency tile calling `/api/fx` before the
visitor had agreed to anything.

The stores still hydrate; that is harmless, because a store reads local data
and sends nothing. What waits now is **mounting**:

- `stores/legal.svelte.ts` is the reactive view of `tp.legal.v1`;
- the deck page's loading effect and the `/w/[id]` detail route return early
  until it says the current version was accepted;
- accepting flips it, so the deck appears without a reload.

The e2e test that found the fault is the one that holds the line: no
`.grid-stack-item` and no `/api/*` request before the click, both after it.

**Mechanism (added 2026-08-10 — this section previously stated three
requirements without saying how they coexist).** Acceptance lives in
localStorage, which a prerenderer cannot read, so the prerendered HTML always
contains the gate; without more, every returning visitor would see it flash.
`static/boot.js` runs synchronously in `<head>` before first paint, reads
`tp.legal.v1`, and sets `data-legal="ok"` on `<html>`; CSS keys off that
attribute to hide the gate and reveal the deck. It is a separate file rather
than an inline script because CSP forbids inline scripts (doc 15 §2), and it
fails closed — a corrupt value or a thrown error leaves the gate up.

The gate wraps the `(app)` route group only. `/legal/*` is outside it, so the
terms, privacy, and licenses pages the gate links to stay readable before
acceptance.

`boot.js` hardcodes `LEGAL_VERSION` because it cannot import the bundle; a test
asserts it equals the constant in `shared-constants.ts`, so bumping the version
to re-gate users cannot silently fail.

## 3. Privacy stance (the actual policy, summarized)

1. No accounts, no analytics, no telemetry, no ads, no cookies.
2. All personal content (layout, notes, todos, events, playlists, files,
   saved places) stays in the browser's storage on the user's device.
3. Network requests go to TilePier's own `/api` proxy; the proxy holds no
   user identifiers, keeps no logs of its own, and caches only the public
   data payloads themselves. Cloudflare, as the infrastructure provider,
   processes requests per its own policies (link).
4. Coordinates are rounded (~1 km) before leaving the device; searches
   (geocoding, symbols, RSS URLs) necessarily transit the proxy to be
   fulfilled and are cached anonymously.
5. Bug reports are user-initiated and user-reviewed before submission
   (doc 18); nothing is sent automatically.
6. Data deletion = browser storage clear + the in-app "Xóa toàn bộ dữ liệu"
   button in Settings (wipes localStorage keys + Dexie db, with export
   offer first).

`/legal/privacy` is the human-readable version of the above in VI + EN.

## 4. Disclaimers (surface in-product, not only in terms)

- Markets: "Dữ liệu có thể trễ và chỉ mang tính tham khảo — không phải
  khuyến nghị đầu tư." rendered in the markets detail footer permanently.
- Weather: forecast-nature disclaimer one-liner on detail.
- Terms include: no warranty (GPL §15–16 spirit), personal-use service,
  fair-use of the hosted instance (rate limits), right to discontinue.

## 5. Third-party attribution register

Rendered at `/legal/licenses`, in **two parts** (split 2026-08-19, because doc
23 makes the real licences text a Week 1 deliverable while `licenses:gen` is a
Week 8 script — the page had no defined interim content):

1. The **curated obligation register**, the table below. Hand-authored bilingual
   prose, shipped Week 1. It is the legally load-bearing half and no script can
   produce it.
2. The **dependency licence appendix**, generated in Week 8 by
   `pnpm licenses:gen` (reads `package.json` + this list) into
   `src/lib/legal/licenses.generated.json` and rendered below the register.

The page marks the boundary with an HTML comment so the Week 8 generator has an
unambiguous insertion point.

| Item | License | Obligation |
|------|---------|-----------|
| Open-Meteo data | CC BY 4.0 (non-commercial API tier) | credit + link (weather detail + licenses) |
| ExchangeRate-API open endpoint | free w/ attribution | visible link where rates shown |
| OpenStreetMap data (tiles, geocoding) | ODbL | "© OpenStreetMap contributors" on map + licenses |
| OpenFreeMap | free tiles | courtesy credit |
| Photon (komoot) | Apache-2.0 service | credit on licenses |
| Nominatim | policy: UA + caching | technical compliance (doc 10 §6) + credit |
| Finnhub / Twelve Data / Binance / Stooq | per ToS | credit lines in markets detail + licenses |
| gridstack (MIT), ECharts (Apache-2.0), MapLibre (BSD-3), Dexie (Apache-2.0), Svelte/Kit (MIT), Tailwind (MIT), marked (MIT), DOMPurify (Apache-2.0/MPL dual), music-metadata (MIT), Paraglide (Apache-2.0), fast-xml-parser (MIT), icon sources (ISC) | — | license texts reproduced in licenses page bundle |
| Bundled quote dataset (from QuoteAtlas) | CC0 1.0 for curation and own translations; originals public-domain | `src/lib/widgets/quote/data/DATA-LICENSE.md`, the source note in the quote detail, and a line on the licences page. `scripts/quotes-import.mjs` refuses to build if an entry marked `quoted-with-attribution` appears, and `service.test.ts` asserts the same rule over the shipped file |
| qrcode-generator (Kazuhiko Arase) | MIT | licence text in the licences page bundle; "QR Code" is a registered trademark of DENSO WAVE, which the library's own notice records and this page carries |
| Be Vietnam Pro, JetBrains Mono | OFL 1.1 | OFL text shipped with fonts; fonts not sold separately |
| Hồ Ngọc Đức lunar algorithm | published algorithm w/ permission notice | credit line in licenses + `lib/lunar/README` (carry the same notice used in QuoteAtlas) |

**One deviation, recorded 2026-08-31.** The currency tile can be dragged to
2×1, which leaves about 34 px of body — one line, and no room for a link. The
credit is a real `<a>` at every other density and in the detail; at h=1 it moves
into the tile’s `title` and its accessible name. doc 08 §2 carries the reasoning
and the escalation if that is ever judged insufficient.

## 6. Trademark / naming

"TilePier" — quick collision check at repo init (GitHub, npm, domains,
trademark databases surface-level). No logo similarity to existing map/
tile products. Wordmark set in Be Vietnam Pro SemiBold.

## 7. Non-lawyer note

These docs structure the obligations; final terms/privacy text is short,
plain-language, and can be reviewed later — the product's exposure is low
(no payments, no accounts, no UGC hosting).
