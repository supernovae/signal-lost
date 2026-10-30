# Architecture

- `content/` holds declarative game content as JSON. `src/` holds the engine. The engine must not hardcode episode text, IDs of specific puzzles, or solutions.
- `src/` modules: `app` (bootstrap, scene lifecycle), `render` (Three.js), `input`, `terminal`, `signal` (deterministic simulation), `puzzle` (evaluation and state), `narrative` (ECHO dialogue), `world` (map), `content` (schemas, loading), `progress` (save data), `audio`, `integrations` (optional external links).
- Pure logic (`signal`, `puzzle`, `narrative`, `content`, `progress`) must not touch the DOM or Three.js, so Vitest can cover it in Node.
- No backend, ECS, plugin sandbox, or elaborate event bus. Sandboxed agents have no network: new npm dependencies need a maintainer change to `package-lock.json` on `main` first.
- Contract-driven WorkUnits live in GitHub Issues and compile into `.swarm/active/WORKUNIT.md`. Protected paths are enforced by `swarm issue validate`.
