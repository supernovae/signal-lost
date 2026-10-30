# Lessons From This Repository

Things that have surprised contributors here before. Agents read this file with every task, so a line added
here saves the next person from relearning it. Keep entries short and concrete.

<!-- Example:
- The integration tests need `make db-up` first; a failing `go test ./...` without it is not a code bug.
-->

- Validation sandboxes forbid listening on a TCP port, so `vite preview` cannot run there. Browser tests use `tests/e2e/fixtures.ts`, which serves `dist/` by request interception under `/signal-lost/`. Do not add a `webServer` to the Playwright config.
- Chromium cannot start in validation sandboxes (`shutdown` is denied), so `npm run test:e2e` is not a required check and agents in a sandbox cannot run it. The `Browser tests` workflow runs it on every PR; it must pass before merge. Keep it meaningful by adding journeys there as features land.
- Sandboxes have no network. A new npm dependency needs a maintainer change to `package-lock.json` on `main` before the WorkUnit runs.
