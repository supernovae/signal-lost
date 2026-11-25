# SIGNAL//LOST: The Observer Network

_We thought we were searching for intelligence. We were building it together._

**[Play it in your browser](https://supernovae.github.io/signal-lost/)**. Episode 000 takes about 15 minutes. Play for free without an account or download.

A volunteer computing network searching for signals from space went silent after detecting something impossible. Twenty-five years later it has come back on, and it wants more observers. It looks like an old client and a BBS door game. It doesn't stay that simple.

Episode 000 has three puzzles, a damaged network process called ECHO, and a small map to explore afterwards. ECHO's dialogue and hints are scripted.

Finish Episode 000 to earn your Observer designation and use CONNECT to join Deep Field. In Chapter 2, **The Deferred Line**, follow the BBS messages, play door games, and work with ECHO and SYSOP to recover a missing record. FORGE is an optional side activity and contribution guide.

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
- Saves stay in one browser's local storage. The game upgrades older Episode 000 saves when you open it, so you can continue with your existing progress and designation.

## License

[MIT](LICENSE).
