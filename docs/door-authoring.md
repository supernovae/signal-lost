# Author a BBS door

Use a declarative JSON adventure for locations, evidence, dialogue, action conditions and endings. Use a code door when the interaction needs a mechanic implemented in TypeScript, such as Signal Hunter's signal analysis.

## Make your first door

From the repository root, copy the [starter](examples/first-door.json) into the game's door directory.

```bash
cp docs/examples/first-door.json content/doors/bench-log.json
```

Replace these top-level fields in the copy and keep the rest of the file.

```json
{
  "id": "bench-log",
  "name": "BENCH LOG",
  "attribution": { "author": "Example Contributor" }
}
```

Run the door's validation and lifecycle smoke test. The checker also runs `tests/unit/doors/<id>.test.ts` when that file exists. Use the reported file and field to find a validation error.

```bash
npm run door:check -- bench-log
npm run dev
```

Open <http://localhost:5173/signal-lost/door-preview?id=bench-log>. Use the buttons or type `READ LOG` to reveal the evidence, then `FILE LOG` to see “The bench log is filed.” and earn `flag:bench-log-filed`. Use `EXIT` to end the preview.

The local preview starts a fresh in-memory session on every reload and bypasses the entry gate after validation. In the game, `requires: { "all": [] }` makes the door available to signed-in players without a story prerequisite. Change `requires` to a saved-fact condition when the story calls for a gate.

For your own door, choose a unique ID and matching filename, set your display name and attribution, and edit the location and item text. When you rename the reward, update both `rewards` and `rewardRules`. Keep the inspect action's item reference and the end action's ending reference in sync with their records. The [content authoring guide](content-authoring.md#bbs-adventures) describes the other adventure actions.

## Code doors

Export a lifecycle with [`defineDoor`](../src/doors/contract.ts), using the [Signal Hunter lifecycle](../src/doors/signal-hunter/signal-hunter.ts) as a reference. Register its metadata and literal lazy import in the [code door catalog](../src/doors/code-doors.ts), then use the same checker and preview with its ID.

Code doors are reviewed and bundled with the game. No door code is fetched or loaded from outside the reviewed bundle at runtime. Selecting a code door loads its shipped lazy chunk through the catalog. The ID identifies a registered door.
