# 18 · Bug Reporting

Goal: a user (or the developer dogfooding) can file a useful GitHub issue
in under a minute, with console context attached, without TilePier ever
phoning home on its own.

## 1. Console ring buffer (`core/log-buffer.ts`)

- Wraps `console.error` and `console.warn` (call-through preserved),
  plus `window.onerror` and `unhandledrejection`.
- Entry: `{ ts, level, msg ≤ 500 chars, stackTop ≤ 3 frames, src? }`.
  Objects serialized shallowly with cycle guard; DOM nodes → tag string.
- Capacity 50, FIFO. Mirrored (throttled 2 s) to
  `sessionStorage['tp.logs']` so a crash-reload still has the tail.
- Scrub pass before export: strip anything matching
  `token|key|secret|authorization` patterns and full URLs' query strings.
- Boot line always logged: `TilePier <version> <sha> <ua-brand> <locale>`.

## 2. Environment block (assembled at report time)

```
version: 1.0.0 (a1b2c3d)        locale: vi · theme: dark
ua: Chrome 143 · Windows        viewport: 2560×1315 @1.0
widgets: clock×2, weather, calendar, markets, music …
layoutHash: 9f3a12               storage: idb ok · fsa granted
online: yes                      swState: activated
```
`layoutHash` = short hash of `tp.layout.v1` (correlates "same layout"
across reports without leaking contents). Never include note/todo/track
contents, place names, or watchlist symbols? — watchlist **is** included
(needed to reproduce markets bugs) with a visible note in the dialog.

## 3. Issue form (`.github/ISSUE_TEMPLATE/bug_report.yml`)

Fields: `what-happened` (textarea, required) · `steps` (textarea) ·
`env` (textarea, auto-paste target) · `logs` (textarea, render as code) ·
`version` (input, prefilled) — plus labels `bug`, auto-title prefix
`[bug] `. Also `config.yml` with blank_issues_enabled: false and links
(feature request template, discussions).

## 4. In-app flow (Settings → "Báo lỗi" · also on the 500 page)

1. Dialog shows: env block + last N log lines, editable preview, privacy
   note ("kiểm tra trước khi gửi — không có gì được gửi tự động").
2. Buttons: **"Sao chép & mở GitHub"** → copies the combined
   env+logs block to clipboard → opens
   `https://github.com/poli0981/tilepier/issues/new?template=bug_report.yml
   &title=[bug]+&labels=bug&version=<v>` (issue-form field prefill via
   query params for short fields; the big block goes via clipboard because
   URL length limits (~8 KB practical) make log-in-URL fragile).
3. Secondary: "Tải log (.txt)" for users without GitHub accounts →
   instructs them to attach it wherever they report (Discord).
4. From the 500 page, the triggering error id + entry are pre-pended.

## 5. Dev diagnostics

`?debug=1` (or `localStorage tp.debug`) unlocks a diagnostics panel in
Settings: live ring buffer view, scheduler table (keys, cadence, last run,
state), swr cache ages, breaker states from `/api/_health` (token-gated,
doc 11 §9). Ships in prod (it's harmless + invaluable for remote users'
screenshots) but hidden behind the flag.

## 6. Explicit non-goals

No Sentry/GlitchTip/telemetry SDKs — conflicts with the privacy stance
(doc 16 §3) and the zero-cost target. The ring-buffer + issue-form flow is
the whole story; revisit only if real-world triage proves insufficient.
