# Contributing

SIGNAL//LOST is meant to be added to. There are three ways in, and none of them needs an account beyond GitHub.

## Without writing code

Write the idea and someone will help turn it into content, with credit to you.

- [File a transmission](https://github.com/supernovae/signal-lost/issues/new?template=propose-transmission.yml)
- [File an archive entry](https://github.com/supernovae/signal-lost/issues/new?template=propose-archive-entry.yml)
- [Report a bug or share an idea](https://github.com/supernovae/signal-lost/issues/new?template=swarm-community.yml)

## With code or content, without SwarmOS

You need Node 24 and nothing else.

```bash
git clone https://github.com/supernovae/signal-lost.git
cd signal-lost
npm ci
npm run dev
```

Adding a transmission or archive entry only takes a JSON file. [docs/content-authoring.md](docs/content-authoring.md) walks through one from start to finish.

Before opening a pull request, run:

```bash
npm run format:check
npm run lint
npm test
npm run test:e2e
```

The browser tests need `npx playwright install chromium` once. Fork the repository, open a pull request, and a person reviews it. Nothing merges automatically, and everything that ships keeps its attribution.

## With SwarmOS

Larger work is tracked as SwarmOS WorkUnits: GitHub issues with an objective, constraints, and acceptance criteria. An agent or a person can claim an approved WorkUnit and work on it in an isolated worktree. SwarmOS is optional. Start with [AGENTS.md](AGENTS.md).

## What we're looking for

Good contributions fit the tone in [docs/content-authoring.md](docs/content-authoring.md) and leave the mystery a little bigger. Please don't include personal data, or work you don't have the right to share under the project's MIT license.
