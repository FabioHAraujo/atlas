# Governance

Atlas is maintained by [CodeAtlas](https://github.com/codeatlasdev). This is a small project with a simple model; it will be revisited when there are more maintainers.

## Roles

| Role | Who | What they do |
|---|---|---|
| **Owner** | [@mvilacad](https://github.com/mvilacad) (the `atlas-owner` team) | Roadmap, final say, cuts every release, the only role that bypasses the branch rules |
| **Maintainer** | Invited contributors with write access | Review, triage issues, merge approved pull requests (squash by default), enforce the [Code of Conduct](CODE_OF_CONDUCT.md) |
| **Reviewer** | Contributors invited to review | Their approval counts toward the two required for a merge, and `CODEOWNERS` can route requests to them |
| **Contributor** | Anyone who sends an issue, a pull request or a review | Follows [CONTRIBUTING.md](CONTRIBUTING.md) |

Nobody, in any role, merges their own pull request. The one flow, step by step, lives in [CONTRIBUTING.md](CONTRIBUTING.md#pull-request-flow-and-who-merges); this page does not repeat it. `CODEOWNERS` routes review requests, and it names the owner on everything and on the sensitive paths (`.github/`, `scripts/release*`, `crates/atlas-host`, `AGENTS.md`).

## Why merging your own pull request is not allowed

Pull request #3 (Linux support) was merged by its own author with no reviews. CI was green and nothing was lost, but the repository's settings allowed it, and a process that depends on everyone remembering to ask is not a process. So the rule is now enforced by GitHub instead of by memory: a pull request needs two approvals from people other than the author, every required check green, resolved review threads and an up-to-date branch, and only the owner can bypass that, for releases and emergency hotfixes (details in [CONTRIBUTING.md](CONTRIBUTING.md#pull-request-flow-and-who-merges)). It applies to the owner's own changes too, except for those two cases. It is a statement about the process, not about any person.

## How decisions are made

- Small fixes: two human approvals and a green CI, as in the flow above.
- Features, config-schema changes, CLI flag changes, MCP tool changes and anything touching the runtime safety rules in [AGENTS.md](AGENTS.md): discuss in an issue first; the owner decides when there is no consensus.
- Public surfaces (CLI flags, `atlas.yaml`, MCP tools) follow [SemVer](https://semver.org); breaking changes are called out in [CHANGELOG.md](CHANGELOG.md). The release channels (Stable, Beta, Alpha) and what each promises are in [docs/versioning.md](docs/versioning.md), and how something is deprecated and removed is in [docs/deprecation.md](docs/deprecation.md). Releases are the owner's call alone.
- Issues are triaged by a maintainer using the labels and targets in [docs/labels.md](docs/labels.md).
- Pull requests opened by AI agents without a person driving them are closed; see [AI-assisted contributions](CONTRIBUTING.md#ai-assisted-contributions).

## Becoming a reviewer or maintainer

- **Reviewer.** A contributor who has landed a few non-trivial changes and leaves useful, correct reviews can be asked by a maintainer, or can ask, to be added as a reviewer. The owner confirms. Reviewing a change you do not understand well is a reason to hand it to someone else, not to approve it.
- **Maintainer.** Reviewers who have landed several substantial changes, review others' work well and follow the Code of Conduct can be invited by the owner and the existing maintainers. Maintainers who are inactive for a long time may be moved to emeritus.
- Access is granted and removed by the owner in the GitHub organization; nothing here changes who may bypass the branch rules.

## Licensing and contributions

Atlas is dual-licensed under MIT or Apache-2.0. Contributions are accepted under the [Developer Certificate of Origin](https://developercertificate.org/) (`Signed-off-by`), with no CLA; see [CONTRIBUTING.md](CONTRIBUTING.md#developer-certificate-of-origin-dco). The name and logo are CodeAtlas's: forks are welcome under the licenses, but please rename them so they are not confused with this project.
