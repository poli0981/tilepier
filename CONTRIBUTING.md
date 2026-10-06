# Contributing to TilePier

Thank you for looking. TilePier is a small project with one maintainer, so a
short note before a large change saves us both time: open an issue or a
discussion first and say what you have in mind.

Bugs go through the in-app report (Settings → Report a bug), which fills in the
version and environment for you, or the
[issue form](https://github.com/poli0981/tilepier/issues/new/choose).
**Security problems never go in a public issue**: see [SECURITY.md](SECURITY.md).

## The licence

TilePier is GPL-3.0-only, and a contribution is accepted under the same
licence. There is no CLA. Signing off your commits under the
[Developer Certificate of Origin](https://developercertificate.org/)
(`git commit -s`) is welcome.

## Setting up

Node 24 and pnpm 11 (`corepack enable` provides it). Then `pnpm install` and
`pnpm dev`. The README says which tiles need keys, and `.dev.vars.example`
names them.

## Making a change

- **Read the docs first.** `docs/internal/` is the source of truth (docs
  01–23), and [CLAUDE.md](CLAUDE.md) is its operational summary: the stack, the
  commands, and the hard rules. When the code and a doc disagree, a pull
  request changes both or neither.
- **Run what CI runs.** `pnpm clean && pnpm verify` (lint, dead code, the i18n
  and design-token audits, tests with coverage thresholds, build, bundle
  budgets, the licence appendix), then `pnpm test:e2e`.
- **Show a regression test failing.** On the parent commit, or under a
  mutation of the code it guards; say which in the pull request. The template
  asks.
- **Both languages, always.** Every string a person sees is a message in both
  `messages/en.json` and `messages/vi.json`, in the same change.
- **Nothing new from the network.** The browser talks only to the app's own
  origin and the three hosts CLAUDE.md names; everything else goes through
  `/api/*`, and nothing loads from a CDN.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/),
  scoped to the widget or area: `fix(weather): …`, `feat(settings): …`. Each
  commit passes on its own; `knip` fails a module that lands without its first
  user, so a primitive arrives with the code that uses it.
- **Pull requests** are squash-merged into `main`, which deploys. The `ci`
  and `e2e` checks must pass.

## Severity

Bugs are triaged into the P0–P3 levels defined in
`docs/internal/19-TESTING.md` §7. An open P0 or P1 blocks a release.
