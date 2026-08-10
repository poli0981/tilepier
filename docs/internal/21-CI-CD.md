# 21 · CI / CD

Pattern: thin **caller stubs** in `tilepier/.github/workflows/` invoking
reusable workflows from `poli0981/.github`. Known GitHub quirk (established
2026-05): callers **must** declare explicit `permissions:` blocks — reusable
workflows do not reliably inherit them. Every stub below includes them.

> **Status 2026-08-10 — the reusable targets below do not exist yet.**
> `poli0981/.github` was checked: it uses a `reusable-*.yml` naming convention
> and ships nothing for Cloudflare deploy, Cloudflare preview, Playwright, or
> release. Only CodeQL has a usable target today
> (`reusable-codeql.yml` / `codeql.yml`). Until the `wf-*.yml` set is written,
> **TilePier authors these workflows locally** in `.github/workflows/` with
> the same jobs and the §2 permissions matrix, and they are extracted upward
> once stable (doc 01 decisions log, 2026-08-10). Treat the "Reusable target"
> column below as the target state, not the current one.

## 1. Workflow set

| Stub | Trigger | Reusable target | Purpose |
|------|---------|-----------------|---------|
| `ci.yml` | PR + push main | `wf-node-ci.yml` | pnpm install → lint → svelte-check → knip → vitest (coverage gates) → build → budgets |
| `e2e.yml` | PR (label `e2e`) + nightly | `wf-playwright.yml` | Playwright smoke matrix |
| `codeql.yml` | push main + weekly | `wf-codeql.yml` (js-ts) | static analysis |
| `deploy.yml` | push main (after CI) | `wf-cf-deploy.yml` | wrangler deploy to production |
| `preview.yml` | PR | `wf-cf-preview.yml` | wrangler versions upload → preview URL comment |
| `release.yml` | tag `v*` | `wf-release.yml` | GitHub Release + changelog |
| `notify.yml` | release published | `wf-notify.yml` | Discord/Telegram ping |

## 2. Permissions matrix (explicit in every caller)

| Stub | permissions |
|------|-------------|
| ci.yml | `contents: read` |
| e2e.yml | `contents: read` |
| codeql.yml | `actions: read`, `contents: read`, `security-events: write` |
| deploy.yml | `contents: read`, `deployments: write` |
| preview.yml | `contents: read`, `pull-requests: write` (URL comment) |
| release.yml | `contents: write` |
| notify.yml | `contents: read`, `actions: read` |

## 3. Caller stub template (reference)

```yaml
name: ci
on:
  pull_request:
  push: { branches: [main] }
permissions:
  contents: read   # explicit — do not rely on inheritance (2026-05 bug)
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  ci:
    uses: poli0981/.github/.github/workflows/wf-node-ci.yml@main
    with:
      node-version: "24"
      pnpm-version: "10"
      run-budgets: true
```

If `wf-node-ci.yml` lacks inputs used here (budgets step), extend the
reusable workflow in `poli0981/.github` first — repo-local one-off steps
are the exception, not the rule (suite consistency).

## 4. Deploy pipeline (Cloudflare Workers)

- `pnpm build` (adapter-cloudflare output) → `wrangler deploy` using
  repo secrets `CLOUDFLARE_API_TOKEN` (scoped: Workers Scripts:Edit, KV:Edit
  for the two namespaces, zone tilepier route) + `CLOUDFLARE_ACCOUNT_ID`.
- `wrangler.toml`: worker name `tilepier`, custom domain
  `tilepier.win`, KV binding `TILEPIER_CACHE`
  (+ `_preview` namespace for preview deploys), secrets `FINNHUB_KEY`,
  `TWELVEDATA_KEY` set via `wrangler secret put` (never in repo/CI logs).
- Preview: `wrangler versions upload` → preview URL; KV points at the
  preview namespace so cache experiments can't pollute prod.
- Rollback: `wrangler rollback` runbook note + previous version retained.

## 5. Client-bundle secret gate

CI step after build (part of `wf-node-ci` via input flag):
`grep -RInE '(FINNHUB|TWELVEDATA)_?KEY|sk-[A-Za-z0-9]{20}' .svelte-kit/cloudflare/assets/`
must return empty; also scan for `https://cdn|unpkg|jsdelivr` (doc 15 §6).
Fails the build on any hit.

## 6. Renovate

Extends the shared org preset; groups: dev-deps weekly, prod patch weekly,
majors individual with `stabilityDays: 3`; lockfile maintenance monthly;
`engines` pinned so Node 26-Current doesn't sneak in before its LTS date.

## 7. Branch protection (repo settings checklist)

main: require CI green, require linear history, no force push. Tags
protected `v*`. Actions: default `GITHUB_TOKEN` read-only at repo level
(stubs escalate per §2), fork PRs get no secrets (preview deploy skips on
forks via `if: github.event.pull_request.head.repo.full_name == github.repository`).
