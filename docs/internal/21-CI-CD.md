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
| `e2e.yml` | PR + push main + nightly | `wf-playwright.yml` | Playwright smoke matrix |
| `codeql.yml` | push main + weekly | `wf-codeql.yml` (js-ts) | static analysis |
| ~~`deploy.yml`~~ | — | — | **Removed 2026-08-10** — see §4 |
| ~~`preview.yml`~~ | — | — | **Removed 2026-08-10** — see §4 |
| `release.yml` | tag `v*` | `wf-release.yml` | GitHub Release + changelog |
| `notify.yml` | release published | `wf-notify.yml` | Discord/Telegram ping |

## 2. Permissions matrix (explicit in every caller)

A caller must grant **at least** everything the called workflow's jobs declare —
a reusable workflow cannot request more than it was given, and the run fails at
startup with no logs when it tries. Read the target's job-level `permissions`
block before writing a stub; the `packages: read` row below was learned that
way on 2026-08-10.

| Stub | permissions |
|------|-------------|
| ci.yml | `contents: read` |
| e2e.yml | `contents: read` |
| codeql.yml | `actions: read`, `contents: read`, `security-events: write`, `packages: read` |
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

**Changed 2026-08-10: Cloudflare builds and deploys, GitHub Actions does not.**
The Workers Git integration is connected in the dashboard and triggers on push,
so an Actions deploy job on the same event shipped the same commit twice. Both
`deploy.yml` and `preview.yml` are removed; Cloudflare also produces preview
URLs for non-production branches, which is what `preview.yml` existed to do.

**The dashboard must be told how to build.** Cloudflare Workers Builds clones
the repo, installs dependencies, then runs its *deploy* command. If the
**build command is left empty**, nothing generates the adapter output and the
deploy fails with:

```
✘ [ERROR] The entry-point file at ".svelte-kit/cloudflare/_worker.js" was not found.
```

Set it in Workers → tilepier → Settings → Builds:

| Field | Value |
|---|---|
| Build command | `pnpm run build` |
| Deploy command | `npx wrangler deploy` |
| Root directory | *(repo root)* |

This cannot be committed to the repo: the installed Wrangler has no `build`
key in its config schema, so there is no `wrangler.jsonc` hook to put it in —
checked, rather than assumed. The equivalent for a human is
`pnpm run deploy:prod`, which builds first for exactly this reason.

Consequences worth keeping straight:

- **The dashboard owns routing.** The custom domain `tilepier.win` is bound
  there, and the `routes` key is deliberately absent from `wrangler.jsonc` —
  declaring it in both places is how a deploy silently rebinds a hostname.
- **No Cloudflare credentials in GitHub.** `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID` are no longer needed as repo secrets; Cloudflare
  builds with its own credentials. One fewer place a token can leak.
- CI (`ci.yml`) still gates every push and PR — lint, knip, tests, build,
  budgets, secret grep. It just no longer ships anything.
- `pnpm run deploy:prod` remains for a deliberate manual deploy from a
  developer machine; it builds first, because `wrangler deploy` on its own
  fails with "entry-point file … was not found".

`wrangler.jsonc` carries: worker name `tilepier`, KV binding `TILEPIER_CACHE`
(+ `preview_id` so branch builds cannot pollute the production cache), and the
`compatibility_date` pinned to what the installed workerd supports. Secrets
`FINNHUB_KEY` / `TWELVEDATA_KEY` are set with `wrangler secret put` and never
appear in the repo.

Rollback: previous versions are retained — roll back from the dashboard, or
`wrangler rollback` locally.

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
(stubs escalate per §2).

Implemented as a repository **ruleset** (`gh api -X POST repos/<owner>/<repo>/rulesets`),
specified 2026-08-19 — the checklist above named no status checks and did not
say whether a PR is required, so it could not be applied without guessing:

- **Required status check contexts: `ci` and `e2e`.** Those are the job ids in
  `ci.yml` and `e2e.yml`; neither job declares a `name:`, so GitHub reports the
  check run under the job id.
- **`codeql` is deliberately not required.** It triggers on `push: [main]` and
  `schedule` only, never on `pull_request`, so requiring it would leave every PR
  waiting forever on a check that cannot report.
- Rules: `deletion`, `non_fast_forward`, `required_linear_history`,
  `required_status_checks`, `pull_request` with
  `required_approving_review_count: 0` and `allowed_merge_methods: ["squash"]`.
  Zero approvals with the PR rule still on is what makes doc 20 §5's
  "PRs for `core/` and `routes/api/`" real while still letting one person merge
  their own work.
- `strict_required_status_checks_policy: false` — requiring branches to be up to
  date forces a rebase after every merge, which for a solo dev already under a
  linear-history rule is friction with no safety attached.
- `bypass_actors` contains the repository-admin role, which is how doc 20 §5's
  "direct pushes acceptable for docs" and this section's "require CI green"
  coexist. Better than `enforcement: "evaluate"`, which gates nothing while
  looking like it does.

A second ruleset targets `refs/tags/v*` with `deletion` + `non_fast_forward`.

**Applied 2026-08-19.** Ruleset `21027640` (`main`) and `21027648`
(`release-tags`), both `enforcement: active`. The check-run names were read off
the repository before writing them in, not assumed — GitHub reports the job ids
verbatim as `ci` and `e2e`. Cloudflare's own `Workers Builds: tilepier` check is
deliberately **not** required, for the same reason as `codeql`: it runs on push
to `main`, not on pull requests, so requiring it would block every PR on a check
that never reports. The admin bypass was verified by pushing directly to `main`
immediately after applying the rules, rather than trusted from the API
response.

The fork-PR secrets guard previously named here belonged to `preview.yml`, which
§1 removed on 2026-08-10; dropped.
