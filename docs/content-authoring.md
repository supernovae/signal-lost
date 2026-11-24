# Content authoring

Everything a player reads lives in `content/` as JSON. You can add to the game without touching TypeScript or the engine. Run `npm ci` once, and `npm run dev` to play your change locally.

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

`bbs-read:` comes from BBS message reads and can only appear in conditions. Archive-tool reads use
`read:`. Opening an archive from the BBS does not create a `bbs-read:` fact.

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

## BBS conversations

Use `kind: "bbs"` on a line in `content/characters/`. Line IDs are unique across all
characters. Lines use the same optional `when`, `failures`, `priority` and `once` fields as
other dialogue. Higher priority wins, with ties resolved in authored order.

An endpoint can route SYSOP to a character with `sysopCharacterId`. That character needs a
repeatable, unconditional BBS line. Static `sysopGreeting` text remains available for legacy
endpoints and as a fallback. A BBS profile's `characterId` offers TALK when the character has BBS
lines. Conversation is scripted, and facts and unlocks are independent of the lines displayed.

## Other kinds of content

| Directory               | Holds                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `transmissions/`        | Text the player acquires.                                                                                               |
| `archives/`             | BBS messages and records. Set `keywords`, and `searchOnly: true` to hide one until it is searched for by exact keyword. |
| `community/`            | One file holding several transmissions and archive entries, with shared attribution. `first-light.json` is the example. |
| `characters/`           | Scripted dialogue, including ECHO's hub lines and BBS conversations.                                                    |
| `events/`               | Fact-triggered flag grants and BBS bulletins.                                                                           |
| `sectors/`              | Network map locations.                                                                                                  |
| `puzzles/`, `episodes/` | Puzzles and episodes. These need more care: read `docs/game-design.md` first, because it has the solutions.             |

A new kind of puzzle needs an engine change. A new transmission, archive entry, or community package does not.

## Tone

Clipped, technical, and human at the edges. People in the logs are tired volunteers, not movie scientists. Nothing should explain more than it has to. Do not contradict `docs/game-design.md`, and do not present made-up numbers as real player statistics.
