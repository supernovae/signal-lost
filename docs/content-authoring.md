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
| `discovered:<sector id>`     | The player entered that location.                               |
| `completed:<episode id>`     | The player finished that episode.                               |
| `flag:<name>`                | Something granted that flag. A flag nothing grants is an error. |

## Other kinds of content

| Directory               | Holds                                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `transmissions/`        | Text the player acquires.                                                                                               |
| `archives/`             | BBS messages and records. Set `keywords`, and `searchOnly: true` to hide one until it is searched for by exact keyword. |
| `community/`            | One file holding several transmissions and archive entries, with shared attribution. `first-light.json` is the example. |
| `characters/`           | ECHO's dialogue lines.                                                                                                  |
| `sectors/`              | Network map locations.                                                                                                  |
| `puzzles/`, `episodes/` | Puzzles and episodes. These need more care: read `docs/game-design.md` first, because it has the solutions.             |

A new kind of puzzle needs an engine change. A new transmission, archive entry, or community package does not.

## Tone

Clipped, technical, and human at the edges. People in the logs are tired volunteers, not movie scientists. Nothing should explain more than it has to. Do not contradict `docs/game-design.md`, and do not present made-up numbers as real player statistics.
