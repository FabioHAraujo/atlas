## What and why

<!-- What does this change, and why? Link the issue it closes: "Closes #123". -->

## How it was tested

<!-- Tests added or changed, and anything you ran by hand. -->

## Target branch

<!-- `main`, always, unless this is a cherry-pick to a release branch. A cherry-pick targets `release/X.Y` and only after the fix landed on `main` first: link that commit here and use `git cherry-pick -x`. -->

## Checklist

- [ ] Every commit is signed off (`git commit -s`), see [DCO](../blob/main/CONTRIBUTING.md#developer-certificate-of-origin-dco)
- [ ] `bun run check` passes
- [ ] **Tests first:** for a bug fix, the regression test was written and seen failing before the fix (see [AGENTS.md](../blob/main/AGENTS.md))
- [ ] Tests cover the behavior (boundaries, failures, state transitions)
- [ ] Docs updated in `docs/` when a flag, key, config field or behavior changed
- [ ] `CHANGELOG.md` has a line under `## [Unreleased]` for user-visible changes
- [ ] **Breaking change?** (`atlas.yaml`, CLI flags or exit codes, MCP tool names or arguments, settings files): the changelog entry is under **Changed** or **Removed** and says what to do instead, and the [deprecation policy](../blob/main/docs/deprecation.md) is followed
- [ ] No secrets, private URLs or personal data in the diff
- [ ] I understand every line of this change; AI assistance, if any, is disclosed above
