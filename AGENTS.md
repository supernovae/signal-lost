# AGENTS.md

This repository uses **SwarmOS** for contract-driven software delivery.

## Quick Reference for Coding Agents

- **Agent Factory & Staging Manual**: Read `.swarm/SKILLS.md` for step-by-step instructions on claiming issues (`swarm issue claim`), staging plans and implementations (`swarm issue stage`), reviewing implementation plans (`swarm issue review-plan`), and submitting Draft PRs (`swarm issue submit`).
- **Project Goals & Safety Invariants**: Read `.swarm/goals.md` and `.swarm/rules/default.md`.
- **Architecture & Conventions**: Read `.swarm/project.md`, `.swarm/architecture.md`, and `.swarm/conventions.md`.
- **Validation Policy**: Read `.swarm/validation/required-checks.yaml` as a coordinator-owned reference, not a per-role execution list. Roles follow focused checks and independent review/reuse in TEST_PLAN.md; the coordinator runs the complete trusted-base required policy once after roles finish and before publication. Agent results remain advisory.
- **Active Worktree Context**: When working inside a provisioned task worktree (`.swarm/worktrees/issue-<N>`), always read `.swarm/active/WORKUNIT.md` and `.swarm/active/SYSTEM_PROMPT.md` first.

## This Repository

- **The game**: SIGNAL//LOST, a static browser mystery. Read `docs/architecture.md` for the module map. `docs/game-design.md` holds all story facts and solutions: do not change them unless a WorkUnit says so.
- **Content vs engine**: story text and solutions live in `content/` as JSON. New transmissions, archive entries and community packages need no engine change. See `docs/content-authoring.md`.
- **Pure logic**: `src/content`, `src/progress`, `src/narrative`, and the non-view files in `src/signal`, `src/puzzle`, `src/world` must stay free of DOM and Three.js.
- **In a sandbox**: there is no network, and Chromium cannot start, so leave `npm run test:e2e` to the `Browser tests` workflow. Capture child process output through files. Details are in `.swarm/rules/lessons.md`.
- **Honesty rules**: never call scripted ECHO live AI, never present fictional numbers as real community statistics, and never add a token or a runtime GitHub API call to the client.
