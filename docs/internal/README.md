# TilePier — Documentation Suite

**Project:** TilePier — a widget dashboard for the web
**Repo:** `poli0981/tilepier` · **Prefix:** `Tp*` · **License:** GPL-3.0-only
**Target domain:** `tilepier.win` (Cloudflare Workers custom domain)
**Suite version:** 1.0 · **Date:** 2026-07-19
**Status:** Week 0 complete (2026-08-10) — the doc 22 spike gate is **open**.
All five spikes green — S3's cache model measured on production at 94 % hit
rate. Week 1 may start. Findings and the adjusted backlog: doc 22 §Exit review.

TilePier is a local-first, account-free dashboard of movable/resizable widgets
(weather, markets, music, notes, calendar with Vietnamese lunar dates, and more).
Each widget expands into a rich detail view with charts. Standalone product —
not an OmniDeck companion.

## Reading order

New to the project: 01 → 02 → 03 → 04 → 06 → 12. Implementing a widget:
06 → 07/08/09 → 10 → 11. Setting up the repo: 20 → 21 → 14.

## File index

| # | File | Contents |
|---|------|----------|
| 01 | `01-PROJECT-CHARTER.md` | Vision, goals, non-goals, positioning, success criteria |
| 02 | `02-TECH-STACK.md` | Locked versions (verified 2026-07), rationale, CVE policy |
| 03 | `03-ARCHITECTURE.md` | System overview, module layout, repo structure |
| 04 | `04-DATA-FLOW.md` | SWR pattern, central scheduler, request lifecycle |
| 05 | `05-STORAGE-SCHEMA.md` | localStorage keys, Dexie tables, migrations, export/import |
| 06 | `06-WIDGET-REGISTRY.md` | Manifest spec, lifecycle, lazy loading, gridstack contract |
| 07 | `07-WIDGET-SPECS-TIER1.md` | 7 pure-client widgets (clock … toolbox) |
| 08 | `08-WIDGET-SPECS-TIER2.md` | 5 API widgets (weather, currency, quote, RSS, map) |
| 09 | `09-WIDGET-SPECS-TIER3.md` | 3 heavy widgets (markets, music, media) |
| 10 | `10-API-INTEGRATIONS.md` | Every external API: endpoints, limits, attribution, failure modes |
| 11 | `11-WORKER-PROXY.md` | `/api/*` design, KV cache TTLs, rate limiting, circuit breaker |
| 12 | `12-DESIGN-SYSTEM.md` | "Đài quan trắc" — tokens, typography, color, motif |
| 13 | `13-UI-UX-SPEC.md` | Grid behavior, edit mode, detail-view expansion, states |
| 14 | `14-I18N.md` | Paraglide 2, EN/VI, key conventions, lunar-date formatting |
| 15 | `15-SECURITY.md` | CSP, headers, Cloudflare config, SSRF guards, threat model |
| 16 | `16-LEGAL-PRIVACY.md` | GPL-3.0, legal gate, privacy stance, third-party attribution |
| 17 | `17-ERROR-OFFLINE.md` | Error pages, PWA offline, stale badges, 429 handling |
| 18 | `18-BUG-REPORTING.md` | Console ring buffer, GitHub issue form, prefill flow |
| 19 | `19-TESTING.md` | Vitest, Playwright, MSW, coverage targets, widget DoD |
| 20 | `20-CODE-QUALITY.md` | Conventions, knip, ESLint 9, Prettier, bundle budgets |
| 21 | `21-CI-CD.md` | Caller stubs into `poli0981/.github`, permissions matrix, deploy |
| 22 | `22-SPIKES.md` | 5 P0 validation spikes with pass/fail criteria |
| 23 | `23-ROADMAP.md` | 8-week plan, milestones, release checklist |
| — | `CLAUDE.md` | AI-assistant instruction file → copy to repo root |

## Conventions used in this suite

- "MUST/SHOULD/MAY" follow RFC-2119 intent.
- All sizes in grid units are `w×h` on the 12-column grid (doc 06).
- All cache TTLs are authoritative in doc 11; other docs reference it.
- This suite is **internal planning documentation**, but it lives at
  `docs/internal/` and is **committed publicly** (decided at repo init,
  2026-08-10 — see doc 01 decisions log). It is not gitignored. Write it as
  though readers outside the project will see it. The public-facing repo
  `README.md` is a separate document written at Week 8 (doc 23).

## Locked decisions (2026-07-19)

1. Scope v1.0 = full 15-widget set, 8-week schedule.
2. Markets widget = crypto (Binance, keyless) + US stocks
   (Finnhub quotes + Twelve Data series). VN equities: out of scope v1.
3. Standalone product; no OmniDeck branding or shared design tokens.
4. Name **TilePier**; component prefix `Tp`; design system **"Đài quan trắc"**.
5. Hosting: existing Cloudflare account. Apex domain **`tilepier.win`**
   (changed 2026-08-10 from the `tilepier.poli0981.dev` subdomain — see doc 01
   decisions log).
6. License GPL-3.0-only for code. No CLA; DCO optional.
