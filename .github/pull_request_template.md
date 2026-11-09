<!--
Title: Conventional Commits, scoped to the widget or area (CLAUDE.md rule 14).
A PR touching core/ or routes/api/ passes full CI before it merges.
-->

## What and why

## Red first

<!-- Every regression test seen failing on the parent, or under a mutation of
the code it guards: say which, and how. A test never seen red is not one. -->

| test | how it went red |
| ---- | --------------- |
|      |                 |

## Verify

- [ ] `pnpm clean && pnpm verify`
- [ ] `pnpm test:e2e`
- [ ] The docs say what the code now does (docs 01–23, CLAUDE.md)

## Accessibility (ACCESSIBILITY.md)

<!-- Any change a person sees or operates. Delete this section when none did,
and name what does not apply. -->

- [ ] Every new control works from the keyboard, in a sensible order, and by a single tap or click (no drag-only gesture)
- [ ] Focus is visible, goes into a new dialog or panel, and comes back when it closes
- [ ] Each control and region has a name, a change is announced, and colour is not the only signal
- [ ] New motion respects reduced motion; new states survive forced colours
- [ ] The axe sweep (`e2e/a11y`) covers the new surface and is clean
- [ ] Checked with a screen reader, or said here why not

## Widget Definition of Done (doc 19 §6)

<!-- Delete this section when no widget changed. Name what does not apply. -->

- [ ] Tile view at every allowed density tier
- [ ] Detail view, deep link (`/w/<id>`) included
- [ ] Every state the widget's doc 17 §3 class requires, component-tested; the ones it marks N/A named here
- [ ] i18n: en and vi complete, no hardcoded strings
- [ ] Offline behaviour per doc 17 §3
- [ ] A11y: labels, focus order, contrast, a chart's summary line
- [ ] Perf: chunks within budget (doc 20 §6), no scheduler leak on remove
- [ ] Unit tests for `service.ts` and logic, component tests for the states
- [ ] Spec cross-checked; deviations written back into docs 07–09

## Owner checks on production

<!-- What only a person on the deployed build can confirm, as a checklist. -->
