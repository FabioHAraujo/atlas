---
title: "Deprecation policy"
description: "What counts as Atlas's public surface and how long something is kept before it is removed."
---

# Deprecation policy

This page says how Atlas removes or changes things you may depend on. It adapts the [Kubernetes deprecation policy](https://kubernetes.io/docs/reference/using-api/deprecation-policy/) to a one-maintainer project. The promises per phase are the table in [Versioning and release channels](versioning.md#what-atlas-promises-and-when); this page does not change them, it says how they are carried out.

> **Atlas is in alpha.** Until the first generally available release, every surface below may change between any two releases. What does not change is that the change is written down: see [During alpha](#during-alpha).

## The public surface

These are the things the policy covers. Anything else (internal crates, the Rust API of `atlas-*` crates, log line formats beyond what the docs describe, the look of the TUI and the app) can change in any release.

| Surface | Includes |
|---|---|
| `atlas.yaml` (and `atlas.local.yaml`) | keys, their meaning, defaults and accepted values; see [Configuration](configuration.md) |
| CLI | commands, subcommands, flags, their defaults, and **exit codes**; see [CLI reference](cli.md) |
| MCP | tool names, their arguments and result fields, resources and prompts; see [MCP](mcp.md) |
| Settings files | the files under `~/.atlas` and a project's `.atlas/` (their keys and meaning); see [Desktop settings](desktop-settings.md) |

Environment variables documented in these pages (for example `ATLAS_UPDATE_CHANNEL`) count as part of the CLI.

## During alpha

- A surface may change or be removed in any release, including a patch release.
- Every such change is listed in [`CHANGELOG.md`](https://github.com/codeatlasdev/atlas/blob/main/CHANGELOG.md) under **Changed** or **Removed**, with what to do instead. This is the rule the release notes of every phase follow.
- When it is cheap, the old form keeps working for a while and prints a warning. It is not guaranteed.
- On the **Alpha** channel a change may also land with no warning at all and be fixed in the next build; the changelog entry still appears.

## After general availability

Once Atlas is generally available (the criteria are in [Versioning](versioning.md#general-availability)):

1. **No breaking change inside a major version.** Removing or changing the meaning of something in the public surface waits for the next major version.
2. **Deprecate first.** Before something is removed it is deprecated for **at least one minor release**. Deprecated means:
   - it still works exactly as before;
   - the changelog lists it under **Deprecated** with what to use instead and the release that will remove it;
   - using it prints a **runtime warning** (a CLI warning on stderr, a line in `atlas dev`'s status, a toast in the app, or an `atlas.yaml` diagnostic), once per run, naming the replacement. A deprecation with no replacement says so and says why.
3. **Remove in a major release.** The removal is listed under **Removed** with the same instructions, and the warning is gone with the feature.
4. **A track is not deprecated for a less stable one.** Something stable is not replaced by something that is still alpha or beta.
5. **Exit codes and machine-readable output** (`--json`, MCP results) only gain new values or fields in a minor release; existing ones keep their meaning. Callers should ignore fields they do not know.

New surface starts out marked **experimental** in its docs and the changelog. Experimental surface follows the "During alpha" rule even after general availability, until the docs say it is stable.

## Breaking changes and pull requests

A pull request that changes the public surface carries the `breaking change` [label](labels.md), a changelog entry under **Changed** or **Removed** (or **Deprecated**) that says what to do instead, and a test that fails if the behavior changes by accident. The [pull request template](https://github.com/codeatlasdev/atlas/blob/main/.github/pull_request_template.md) asks for all three.

## Yanked releases

If a release is withdrawn because it is dangerous (data loss, a build that cannot start, a security problem) and a fixed one is available, its changelog heading is marked `[YANKED]` and carries a line saying why and which version replaces it, as the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/#yanked) format does. A yanked release stays published, so installs do not break and tags never move; the GitHub release notes point to the fix. A release that was **deleted** before anyone could rely on it is not marked.

## Platforms and toolchain

Dropping a platform is listed under **Removed** in the changelog. Raising the minimum Rust version for building Atlas is a normal change, called out under **Changed** (see [Contributing](contributing.md)); it is not part of the public surface above.
