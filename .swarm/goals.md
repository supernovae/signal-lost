# Project Goals & Quality Bar

## Mission
Build a 15-minute mystery that makes someone think "I want to know what happens next", then make its universe expandable by contributors. The technology enables the experience; it must not become the experience.

## Non-Negotiable Safety Invariants
- Never modify protected harness or CI files (`.github/workflows/**`, `.swarm/validation/**`, `.swarm/contracts/**`, `.swarm/config.yaml`, `.swarm/prompts/**`, `.swarm/workflows/**`, `.swarm/goals.md`, `.swarm/SKILLS.md`, `.swarm/rules/**`, `.swarm/skills/**`) or the files that shape agent instructions (`.swarm/project.md`, `.swarm/architecture.md`, `.swarm/conventions.md`, `.claude/commands/**`, `.opencode/commands/**`, `AGENTS.md`, `CLAUDE.md`) unless the WorkUnit explicitly sets `allow_harness_changes: true`.
- Every change must trace directly to the approved `WorkUnit` objective, constraints, and acceptance criteria.
- Prefer minimal, well-tested diffs over speculative refactoring or unrequested dependencies.
- The game must stay playable with no account, server, token, or paid API. Never embed a credential in the client.

## Priorities
1. A complete, playable, fair player journey.
2. Deterministic puzzles with automated proof they can be solved.
3. Engine and content stay separate, so a new transmission needs only JSON.
4. Small, understandable code over framework-building.
