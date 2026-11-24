# Architecture

The game is a static site: TypeScript, Vite, Three.js, and zod. All story text and solutions are JSON in `content/`. The engine in `src/` knows about kinds of content, not particular puzzles.

## Modules

| Directory       | Responsibility                                                                                | Touches the DOM?        |
| --------------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| `src/app`       | Bootstrap wiring, scene lifecycle, opening, hub, ending, tool list, settings                  | Yes                     |
| `src/render`    | Three.js environment. `loop.ts` and `host.ts` hold its scheduling and ownership as pure logic | `environment.ts` only   |
| `src/terminal`  | The terminal: log, menu, command input, tool panel                                            | Yes                     |
| `src/bbs`       | Board sign-in, messages, door directory and terminal routing                                  | `bbs-view.ts` only      |
| `src/doors`     | Door contract, registry, lifecycle, scoped checkpoints and declared rewards                   | No                      |
| `src/signal`    | Seeded waterfall, SNR, lock evaluation (pure), and the analyzer view                          | `analyzer-view.ts` only |
| `src/puzzle`    | Answer evaluation and game state (pure), and decoder and inquiry views                        | `*-view.ts` only        |
| `src/narrative` | `DialogueSource` and scripted dialogue                                                        | No                      |
| `src/world`     | Archive search and map logic (pure), and their views                                          | `*-view.ts` only        |
| `src/content`   | Schemas, conditions, validation, manifest, browser and Node readers                           | No                      |
| `src/progress`  | Versioned save data in local storage                                                          | No                      |
| `src/audio`     | Synthesized sound, unlocked by a user gesture                                                 | Web Audio only          |

`src/integrations` from the original plan does not exist: FORGE's only external connection is plain links, so nothing needed it.

## How a puzzle runs

1. `src/app/tools.ts` builds the menu from content and state. A puzzle's tool appears when its `requires` condition holds, and the tool is chosen by the puzzle's `kind`.
2. A view collects an answer and calls `game.attempt(id, answer)`.
3. `evaluateAnswer` judges it deterministically. On success, the game adds `solved:<id>` and the puzzle's `grants`, checks for episode completion, and saves.
4. Everything else, including transmissions, archive entries, map nodes, FORGE and ECHO's lines, is gated by conditions over those facts.

## Content pipeline

`loadContent` validates a map of file paths to parsed JSON, and never throws for bad content. It returns typed content, errors with file and field, and a manifest. The browser bundles `content/**/*.json` through `import.meta.glob`. `scripts/content-plugin.ts` runs the same validation in `npm run build`, fails on errors, and emits `content-manifest.json` with a content version hash. `npm run content:validate` is the same check from the command line.

## ECHO

`createScriptedDialogue` implements the small `DialogueSource` interface. The game records which lines were spoken in the save and never reads dialogue to decide progress, so a model-backed source could implement the interface later without changing progression. No such source exists today.

## Extension points

- New transmissions, archive entries and community packages: JSON only.
- New map locations and ECHO lines: JSON only.
- A new puzzle kind: a schema, an evaluation case, and a view.
- A new declarative door goes in `content/doors/`. The content loader discovers its JSON and the BBS lists it when its entry condition holds.
- A reviewed TypeScript door exports its `defineDoor` lifecycle from a module registered through a literal lazy import in the build-time catalog. The shared validator reads catalog metadata, and the registry loads the module when a signed-in player selects it. [Code door catalog](../src/doors/code-doors.ts)

## How a door runs

The descriptor declares the door's ID, name, description, author attribution, version, entry condition, rewards and return destination. Each implementation supplies a saved-state schema and a completion rule. The lifecycle launches a fresh visit or restores a checkpoint, handles input, saves its state as JSON, and handles exit. Callbacks receive a read-only fact query and work with state local to their visit. The BBS renders their screen text and commands in the shared terminal. [Door contract](../src/doors/contract.ts) · [BBS routing](../src/bbs/door-session.ts)

The host checks entry requirements and reads the slot keyed by the selected door ID. A missing slot, version mismatch or invalid payload starts a fresh visit. Each successful input or exit writes the validated checkpoint and any newly earned declared rewards together. The BBS evaluates board status conditions against those saved facts. EXIT returns to the signed-in main menu. A lifecycle, module-load or persistence failure also returns there with the board's error message and the previous save intact. [Door host](../src/doors/host.ts)

## Determinism and tests

Signal generation uses a seeded generator and never the clock or `Math.random`. The Observer designation's suffix is random but cosmetic. Pure logic is covered by Vitest. Playwright drives the production build under `/signal-lost/` by request interception in `tests/e2e/fixtures.ts`. Set `SIGNAL_LOST_LIVE=1` to run the same specs against the deployed site.
