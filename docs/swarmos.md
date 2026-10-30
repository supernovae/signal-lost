# Working with SwarmOS

Development is tracked with [SwarmOS](https://github.com/supernovae/SwarmOS). It's optional: you can always send an ordinary pull request. See [CONTRIBUTING.md](../CONTRIBUTING.md).

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
