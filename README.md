# SIGNAL//LOST: The Observer Network

_We thought we were searching for intelligence. We were building it together._

**[Play it in your browser](https://supernovae.github.io/signal-lost/)**. No account, no download, about 15 minutes.

A volunteer computing network searching for signals from space went silent after detecting something impossible. Twenty-five years later it has come back on, and it wants more observers. It looks like an old client and a BBS door game. It doesn't stay that simple.

Episode 000 has three puzzles, a damaged network process called ECHO, and a small map to explore afterwards. Your progress stays in your browser. There is no server, no sign-up, and nothing to pay for. ECHO's dialogue is scripted, not a live AI.

Stuck? Ask ECHO: its hints get more direct the more you try.

## Change this universe

This universe is unfinished. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to add to it, with or without writing code.

## Develop

You need Node 24.

```bash
npm ci
npm run dev
```

| Command                                | What it does                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `npm run build`                        | Type-checks, validates content, and builds to `dist/`                                   |
| `npm test`                             | Unit tests                                                                              |
| `npm run test:e2e`                     | Browser tests against a production build. Needs `npx playwright install chromium` once. |
| `npm run content:validate`             | Checks everything in `content/`                                                         |
| `npm run lint`, `npm run format:check` | Static checks                                                                           |

Read [docs/architecture.md](docs/architecture.md) for how the code is organised, [docs/content-authoring.md](docs/content-authoring.md) for adding content, [docs/swarmos.md](docs/swarmos.md) for the work-tracking process, and [docs/roadmap.md](docs/roadmap.md) for where this could go. [docs/game-design.md](docs/game-design.md) has **every puzzle solution**, so play first.

## Known limitations

- Performance has only been measured in CI on a software renderer, with a floor of 10 frames a second. It has not been measured on real integrated graphics.
- Browser tests run in Chromium only. Firefox and Safari are untested.
- The layout is built for laptop and desktop screens. Phone screens are untested.
- Sound is synthesized, and its quality has been checked only by code review, not by ear.
- Puzzle answers are in the client bundle, as in any static site. The mystery runs on good faith.
- The interface uses your system's monospace font.
- Saves live in one browser's local storage and do not sync.

## License

[MIT](LICENSE).
