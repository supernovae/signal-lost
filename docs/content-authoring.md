# Content authoring

Story records and dialogue live in `content/`. You can add transmissions, BBS records, and declarative doors without touching TypeScript. Run `npm ci` once, then `npm run dev` to play your change locally.

## Worked example: add a transmission

### 1. Create the file

Create `content/transmissions/tx-night-shift.json`:

```json
{
  "id": "tx.night-shift",
  "title": "TX-C02  NIGHT SHIFT",
  "requires": "completed:episode.000",
  "body": [
    "RECEIVED 04:12 LOCAL. NOT FROM THE SKY.",
    "",
    "SOMEBODY LEFT THEIR COMPUTER ON. THANK YOU."
  ],
  "attribution": {
    "author": "Your Name",
    "handle": "your-github-handle",
    "sourcePr": "#123"
  }
}
```

- `id` is a stable name that never changes: lowercase letters, digits, `.` and `-`.
- `title` is what the terminal lists.
- `body` is one string per line. Use `""` for a blank line.
- `requires` decides when the player can see it. Leave it out to make it visible from the start.
- `attribution` gives you the `FILED BY` credit in the game. Add `sourcePr` once your pull request has a number.

### 2. Validate it

```bash
npm run content:validate
```

You should see `Content OK`. A problem names the file and the field, for example `content/transmissions/tx-night-shift.json: body: Invalid input`.

### 3. See it in the game

Run `npm run dev` and finish Episode 000, then choose `TRANSMISSIONS` in the terminal. To check it without replaying the episode, change `requires` to `"acquired:tx.fragment"` for a moment, which unlocks it after the first puzzle.

### 4. Send it in

Open a pull request with your one new file. CI runs the same validation, and a person reviews it before it can merge. Nothing merges automatically.

## Conditions

`requires` and similar fields hold a fact, or a combination of facts:

```json
{ "all": ["solved:puzzle.carrier", { "not": "flag:service-panel-open" }] }
```

| Fact                         | True when                                                       |
| ---------------------------- | --------------------------------------------------------------- |
| `solved:<puzzle id>`         | The player solved that puzzle.                                  |
| `acquired:<transmission id>` | A puzzle granted that transmission.                             |
| `read:<archive id>`          | The player opened that archive entry.                           |
| `bbs-read:<message id>`      | The player read that BBS message.                               |
| `discovered:<sector id>`     | The player entered that location.                               |
| `completed:<episode id>`     | The player finished that episode.                               |
| `flag:<name>`                | Something granted that flag. A flag nothing grants is an error. |

`bbs-read:` comes from BBS message reads and cannot be granted by content. Archive-tool reads use
`read:`. Opening an archive from the BBS does not create a `bbs-read:` fact.

## Access levels and earned capabilities

Put each access level in `content/access-levels/` with a stable `id`, a displayed `label`, and a
unique nonnegative integer `rank`. A nonempty catalog needs one unconditional rank 0. Each higher
rank needs a `when` condition. Access conditions accept fact names and nonempty `all` and `any`
groups. They reject `not` so adding facts can only maintain or raise a player's level. Design two
independent ways to reach a level that story progression needs.

A BBS `message-board` can declare `access` with a minimum `level` ID and a `deniedText` line.
The listing stays visible, and the BBS displays that line when the player tries to enter below
the required level.

A message board's optional `requires` condition controls whether it appears in BOARDS and
can be opened. Its optional `check` adds a typed `SEARCH` or `SUBMIT` command with a
single case-insensitive `answer` token. The player must read each `evidenceMessageIds`
message from a public thread on the same endpoint. Write the command instructions in
`prompt` and use `missingEvidence` and `incorrect` to direct retries to the evidence.
The command works from that board and its threads. Set `responseMessageId` to a message
owned by the endpoint with `eventOnly: true`. Give it one exclusive board check and one
event that posts it with `when` set to its own `bbs-read:<message id>` fact. The first
success records that read. Later successes show the same message again.

[The Forgotten Board](../content/bbs/forgotten-board.json) uses SEARCH to locate a batch
after the player reads its index. The [Q17 header desk](../content/bbs/q17-header-desk.json)
uses SUBMIT to check a finding against its evidence messages.

A board with an `orderCheck` lists prerequisite facts with feedback for missing evidence,
operation tokens with out-of-order feedback, and an event-only response message. The listed
operations define the correct order. Use `prompt` to tell players how to submit an order
with APPLY. [Recovery console](../content/bbs/spool-02-recovery.json)

A board can define one `reconstructionCheck` in place of a search, submit or order check.
Its `prerequisites` name saved facts, including the shared manifest reward. Give every
`fragmentMessageIds` entry a public thread on the same board and `retainedModule` data
with the module name, seal, boundary and dependency seals. The `recipe` lists seals in
build order. Both the validator and COMPARE check those fields against the same signed
`content/code-doors/manifest-r07-spool-02.jsonc` data that supplies the doors' manifest display.

Author all operation and evidence-mode pairs with their consequences and retry feedback.
The manifest determines which pair can proceed. The `custody` references identify the
sealed originals, indexed dispatch messages and hold receipt. The replay verifies original
and dispatch seals before emitting the event-only response. The referenced episode must
require that response's read fact and all declared prerequisites. The optional `credits`
copy opens the build-generated contributor record after completion.
[Maintenance Annex](../content/bbs/maintenance-annex.json)

In `content/capabilities/`, give each capability an `id`, a `kind`, an existing saved `fact`, and
a `target`. Use `kind: "research"` with a target such as
`{ "kind": "archive", "id": "archive.example" }` or `{ "kind": "board", "id": "board.example" }`.
Use `kind: "reputation"` with a target such as
`{ "characterId": "sysop", "lineId": "sysop.bbs.example" }`. The line must be reachable through
SYSOP or TALK. Optional `context` lists the other facts needed to demonstrate the effect.
Validation checks that adding the capability fact to that context opens the target or selects
the advertised response with different visible text. The declaration itself grants no facts.

## Network events

Put each event in `content/events/` with a stable `id`, a required `when` condition, and one or
more `effects`. An effect can grant a flag with `{ "kind": "grant-flag", "flag": "name" }` or
post a message with `{ "kind": "post-bulletin", "messageId": "id" }`. A bulletin is a BBS
`message` with `eventOnly: true` whose `board` is a BBS endpoint ID. Posting puts it in that
endpoint's Messages list. It stays marked `[NEW]` across reloads until the player reads it,
then appears as `[READ]`.

After a fact change or BBS connection, the first eligible unfired event in binary ID order runs
its effects in array order. The game then checks eligibility again. The save records each firing
once. Flags granted by events can be used in conditions. Validation rejects flag dependency
cycles, including references in nested or negated conditions. Reading a posted bulletin is a
separate player action and may qualify another event.
[Chapter 2 completion bulletin](../content/events/unassigned-routing-entry.json)

## BBS conversations

Use `kind: "bbs"` on a line in `content/characters/`. Line IDs are unique across all
characters. Lines use the same optional `when`, `failures`, `priority` and `once` fields as
other dialogue. Higher priority wins, with ties resolved in authored order.

An endpoint can route SYSOP to a character with `sysopCharacterId`. That character needs a
repeatable, unconditional BBS line. Static `sysopGreeting` text remains available for legacy
endpoints and as a fallback. A BBS profile's `characterId` offers TALK when the character has BBS
lines. Conversation is scripted, and facts and unlocks are independent of the lines displayed.

## BBS adventures

Follow the [door authoring guide](door-authoring.md) to copy, check and preview your first door.

Use `kind: "trivia"` for a multiple-choice drill. Each question supplies prompt lines,
options, a zero-based answer index, and retry text. The game's buttons and commands number
choices starting at 1. Put the completion text and reward in the door record.
[Relay Trivia](../content/doors/relay-trivia.json)

Add an adventure as a JSON file under `content/doors/` with `kind` set to `adventure`.
The global `requires` condition controls which signed-in players can open the door.
Set `startLocationId`, give each location a title and description, and list its actions
in display order. Each action has a command and button label. Commands within a location
must be distinct after normalizing case and whitespace, including around slashes. The host
reserves EXIT and supplies it on every screen.

Use `move` to connect locations, `inspect` to display and record evidence, `talk` to select
the first matching dialogue variant, `show` to display text such as a notebook, `order` to
submit an operation permutation, and `end` to choose a single ending. End each dialogue list
with an unconditional variant. An order puzzle declares its required evidence, the inputs
and outputs of each operation, missing-input responses, and a local success flag. Provide
authored order actions with each operation exactly once per submission.

Action and dialogue `when` conditions and `rewardRules` use local facts. `read:<id>` means
an inspected item, `flag:<id>` a declared local milestone, and `completed:<id>` the chosen
ending. List every global reward under `rewards` and provide a local rule for earning it.
The loader checks references and walks reachable checkpoints, up to 4,096 states. Run
`npm run content:validate` to check a new door. [Forgotten Archive](../content/doors/forgotten-archive.json)

Use a reviewed TypeScript door for a new interaction with its own mechanics. Export a
`defineDoor` lifecycle with a saved-state schema and register its metadata and lazy import
in the [code door catalog](../src/doors/code-doors.ts). Signal Hunter and Relay Trader use
this path and read the same signed repair manifest. Run `npm run door:check -- <id>`, then
open `/signal-lost/door-preview?id=<id>` on the local Vite dev server to try either door format.
The [door authoring guide](door-authoring.md) has the complete preview steps.

## Other kinds of content

| Directory               | Holds                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `transmissions/`        | Text the player acquires.                                                                                               |
| `archives/`             | Archive records and earlier BBS material. Set `keywords` and `searchOnly: true` to require an exact keyword search.     |
| `bbs/`                  | Endpoints, boards, threads, messages, profiles and BBS interface text.                                                  |
| `doors/`, `code-doors/` | Declarative door records and authored data for bundled code doors.                                                      |
| `community/`            | One file holding several transmissions and archive entries, with shared attribution. `first-light.json` is the example. |
| `characters/`           | Scripted dialogue, including ECHO's hub lines and BBS conversations.                                                    |
| `events/`               | Fact-triggered flag grants and BBS bulletins.                                                                           |
| `sectors/`              | Network map locations.                                                                                                  |
| `puzzles/`, `episodes/` | Puzzles and episodes. These need more care: read `docs/game-design.md` first, because it has the solutions.             |

A new kind of puzzle needs an engine change. A new transmission, archive entry, or community package does not.

Episodes complete when all listed puzzles are solved and every optional `completionFacts`
entry holds. Use a nonempty fact list with `"puzzles": []` for a fact-only episode.
Puzzle-only episodes require a designation prefix. A prefix is optional when the episode
also has fact requirements. An event on `completed:<episode id>` can publish a bulletin
after the ending becomes available. [Chapter 2 episode](../content/episodes/episode-002.json)

## Tone

Clipped, technical, and human at the edges. People in the logs are tired volunteers, not movie scientists. Nothing should explain more than it has to. Do not contradict `docs/game-design.md`, and do not present made-up numbers as real player statistics.
