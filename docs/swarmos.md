# Working with SwarmOS

Development is tracked with [SwarmOS](https://github.com/supernovae/SwarmOS). It's optional: you can always send an ordinary pull request. See [CONTRIBUTING.md](../CONTRIBUTING.md).

## Contribute an idea with agent assistance

FORGE in the game links to no-code GitHub forms for transmissions, archive entries, characters, branching adventures, door games, network locations and mechanic improvements. Describe what a player would find or do and how you'd like to be credited. Maintainers review proposals before they reach the game and agree on the scope and attribution with the contributor.

When a proposal becomes an approved WorkUnit, you can use SwarmOS with a configured coding agent to implement and verify it. For transmissions and archives, follow the [content authoring guide](content-authoring.md). The [door authoring guide](door-authoring.md) walks through the starter, local checker, development preview and code-door registration. You can also follow those guides and send an ordinary pull request.

Use standard `attribution` for your real credit. Maintainers review the `creditKind` classification for maintainer credits and placeholder bylines. Keep fictional names and handles in the story fields.

## Complete a WorkUnit

A WorkUnit is a GitHub issue with an objective, constraints, and acceptance criteria. You need the `swarm` CLI and write access, or `--fork` from your own fork.

```bash
swarm issue claim <issue>
cd .swarm/worktrees/issue-<issue>
npm ci
# Read .swarm/active/WORKUNIT.md, then write .swarm/active/PLAN.md and TEST_PLAN.md
swarm issue stage <issue> --phase plan --harness <name> --model <name>
swarm issue review-plan <issue>
# Implement the approved plan
swarm issue stage <issue> --phase implement --harness <name> --model <name>
swarm issue submit <issue>
```

Submit opens a Draft PR. `swarm issue work <issue>` runs the same steps with a configured agent harness. A maintainer reviews the PR on GitHub before merging.

## Epics on this repository

Native `Epic` issue types need an organization, and this repository is owned by a personal account. So the Epic is a root issue with native sub-issues: [#1](https://github.com/supernovae/signal-lost/issues/1). It has no WorkUnit contract and no ready label, so it can't be claimed. Children are created with `swarm issue create --parent 1`. `swarm issue epic create` and `swarm repo plan --apply` refuse to run here; see [SwarmOS #369](https://github.com/supernovae/SwarmOS/issues/369).

## Validation

Required checks are in `.swarm/validation/required-checks.yaml`: `format`, `lint`, `build`, and `test`.

Browser tests are not among them, because Chromium cannot start in the native validation sandbox ([SwarmOS #370](https://github.com/supernovae/SwarmOS/issues/370)). They run in the `Browser tests` workflow on every PR, and it must pass before merge. Sandboxed agents should leave browser verification to that workflow.

Sandboxes have no network. A new npm dependency has to reach `package-lock.json` on `main` first, through a maintainer change. See `.swarm/rules/lessons.md`.
