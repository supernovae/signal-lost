# Project: signal-lost

SIGNAL//LOST: The Observer Network is an open-source browser mystery game. Its Day 0 episode is a static site on GitHub Pages with no backend, accounts, or paid APIs.

- **Primary Stack**: TypeScript, Vite, Three.js, zod. Vitest and Playwright for tests.
- **Runtime**: Node 24 for tooling. The game runs entirely in the browser.
- **Install**: `npm ci`
- **Build Command**: `npm run build`
- **Test Command**: `npm test` (unit), `npm run test:e2e` (browser, against a production build under `/signal-lost/`; runs in the `Browser tests` CI workflow, not in validation sandboxes)
- **Lint and format**: `npm run lint`, `npm run format:check`
- **Design source of truth**: `docs/game-design.md`. It contains puzzle solutions; do not change the mystery's facts without a WorkUnit that says so.
