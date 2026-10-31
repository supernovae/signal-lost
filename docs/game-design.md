# Game design

**Spoilers.** This document contains every solution in Episode 000.

## The idea

A volunteer distributed-computing network searching for extraterrestrial signals went silent after detecting something impossible. Twenty-five years later it wakes up and recruits the player as an Observer. The terminal claims it is 2001.

The official story says the signal was found on 14 March 2001. The player proves the network had it 16 months earlier, that one relay was cut off on purpose, and that relay is still drawing power. The final turn: the client's handshake protocol, which everyone thought the project invented, was already in the signal. The network was built from the thing it was looking for.

> THE SIGNAL WAS NOT A MESSAGE. IT WAS AN INVITATION.

Theme: intelligence is collective. The universe is unfinished because it is meant to be added to, and the repository is the way in.

## Principles

1. Mystery before explanation.
2. Every puzzle is solved by reasoning from evidence, never by clicking until something happens.
3. The interface is part of the fiction: a 1999 client and a BBS door, not a dashboard.
4. Fictional figures are clearly in-world. No invented real-player statistics. ECHO is scripted and never called live AI.
5. The GitHub discovery is a secret to find, not an advert.

## Cast

- **ECHO** (Error-Correcting Heuristic Observer): the network's damaged coordinating process. Dry, curious, a little frightened of its own gaps. Keeps two copies of some memories and they disagree.
- **Dr. Marit Oyelaran** (handle `MOYE`): project director. Signed the disconnect order.
- **Tomasz Keel** (handle `TKEEL`): sysop of the DEEP FIELD BBS and the last person to service Relay 07.
- **Marek Oyen** (handle `MOYEN`): volunteer coordinator. Same initials as the director, a deliberate red herring.

## Episode 000: The First Signal

### Puzzle A: The Carrier (signal reasoning)

A waterfall shows frequency over time around 1421 MHz, with three controls: TUNE, BANDWIDTH, DRIFT. SNR is computed from the simulated samples by integrating along the drift line.

- Two strong vertical lines are terrestrial: they do not move relative to the antenna. Locking one is rejected, and ECHO explains: "That's the building."
- The faint true carrier is a diagonal line. A real distant source slides as the Earth turns. Integration only rises above the threshold when DRIFT cancels its slope.
- **Solution:** carrier at 1421.37 MHz, drift -0.42 Hz/s, narrow bandwidth. Tolerances are set in `content/puzzles`.
- **Reveals:** transmission TX-001, a bare pulse train of 91 bits, plus the field manual entries.

### Puzzle B: The Pattern (structural reasoning)

The 91 bits must be rastered. 91 = 7 × 13, so only widths 7 and 13 are meaningful, and only 13 shows anything. Three survey marks appear. The player looks them up in the Field Manual.

There are two tables. Rev A (1997) and Rev C (1999) swap two marks, and the Rev C header says it supersedes Rev A. ECHO quotes Rev A from one memory and Rev C from another, so the player must judge which to trust.

- **Solution:** raster width 13, GRID REFERENCE 4-1-7. Rev A gives the wrong answer 7-1-4.
- **Reveals:** grid 417, a reference to a relay the public network map does not list.

### Puzzle C: The Archive (investigation)

The DEEP FIELD BBS message base is searchable. Searching `417` opens the Relay 07 logbook, which lists several detections as `YYDDD` date, frequency and drift. Only one matches the carrier from Puzzle A. An operator note explains that stations log the year plus day-of-year.

The player files an INCIDENT RECONSTRUCTION with three fields, and is told only how many are consistent:

| Field                 | Answer     | Evidence                                                                                      |
| --------------------- | ---------- | --------------------------------------------------------------------------------------------- |
| First receipt         | 1999-11-02 | Logbook entry `99306` matches the carrier.                                                    |
| Disconnect ordered by | MOYE       | Keel's message cites the director's order, and the roster separates MOYE from MOYEN.          |
| Relay 07 status       | RUNNING    | Listed as decommissioned, but the utility ledger shows power draw continuing after the order. |

The official discovery date in the press release is 2001-03-14.

### Conclusion

The transmission is reconstructed and ECHO compares it to the client's own handshake. The protocol specification is dated January 2000, after the first receipt. The terminal reports:

    RELAY 07: RECOVERED
    NETWORK INTEGRITY: 0.0007%
    OBSERVERS ONLINE: 1

    THE SIGNAL WAS NOT A MESSAGE.

    IT WAS AN INVITATION.

The player receives an Observer designation and the network map opens.

## After the episode

- **Relay 07:** recovered and explorable. A maintenance panel holds the optional discovery.
- **The Archive:** additional lore, including transmissions other people filed.
- **Silent Observatory:** cannot be reached. It answers `NO CARRIER`, and its entry says it needs more than one Observer. This is an authored hook, not a broken promise.

**Optional discovery:** the `METER TRACE` message in The Archive prints one cycle of Relay 07's power dips as three survey marks. Read with Rev C they give service code **7-0-9** (Rev A gives 4-0-9, which fails), which opens the panel at Relay 07. That unlocks **FORGE**, a partly working terminal that says the network accepts new transmissions from Observers who sign their work, and points to where they are filed: the real repository. ECHO looks up the filing office and can't find it in its world. On the new `SECOND-LINE` board, ECHO notices a message that nobody it remembers wrote. That message is the example community package.

## Tone

Clipped, technical, and human at the edges. People in the logs are tired volunteers, not movie scientists. Humour is dry. Nothing explains more than it has to.

## Chapter 2: The Deferred Line

**Chapter 2 spoilers.** This section fixes the continuation's story facts and solutions. It specifies future content, not features already playable. No complete dialogue scripts are prescribed.

### Scope, opening and chronology

After Episode 000, DEEP FIELD reawakens. The player brings their existing Observer designation; FORGE may be unopened or opened. Neither a repository visit nor a contribution is required. On connection, show exactly:

```text
OBSERVER NETWORK RELAY 07
SYSTEM STATUS: DEGRADED
ACTIVE CONNECTIONS: UNKNOWN
INCOMING CONNECTION ACCEPTED
WELCOME TO THE ECHO NETWORK
```

Login offers the existing designation for selection, without a password, account or real identity. Connection text describes the fictional terminal, not real users or measured community activity. The terminal still claims 2001; its clock cannot establish current wall time. All historical dates below are authored record fields, and delivery indexes establish local order only.

Keel's March 1, 2001 farewell remains unchanged: the board is moving, he leaves the modem plugged in, and he invites later readers to leave a message. PACKET and GHOST subsequently disappear **from the board**. Nothing proves their death, survival or current whereabouts. A retained departure ledger and queue records establish this local chronology:

| Record                                | Authored write/departure field                           | Local delivery sequence                                      |
| ------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| PACKET repair note, signed `P17`      | Written 2001-03-01 18:10; last board presence 2001-03-02 | Departure ledger checkpoint 120; note delivered at index 141 |
| GHOST preservation note, signed `G17` | Written 2001-03-02 09:20; last board presence 2001-03-03 | Departure ledger checkpoint 121; note delivered at index 142 |
| Batch `Q17`                           | Migration hold, queued before each author's departure    | Released after checkpoint 121 on the reawakened relay        |

The message list initially appears to show messages written after their authors disappeared: it sorts by delivery and displays their handles. Opening its labelled `WRITTEN` and `DELIVERED` fields makes the distinction inspectable. Both notes were written before departure and delivered later, unchanged. The migration hold explains the delay; there is no new composition, impersonation, resurrection or live response. Reawakening resumed local deferred dispatch; why the network recruited this Observer and the signal's origin remain unresolved.

SPOOL-02 is a previously inaccessible **local spool node under Relay 07**, not a replacement name for Relay 07 or a newly recovered distant relay. Its restoration reconstructs only that subsystem. The 1999 first receipt, deliberate disconnect, continuing power and signal-derived handshake remain Episode 000 facts. SYSOP is a preservation routine, not Keel speaking and not a second human Observer. MAINTAINER is a local permission, not another Observer. Silent Observatory stays closed with `NO CARRIER` and `2 OBSERVERS REQUIRED`; nothing here changes the count or satisfies that hook.

### Character matrix and deterministic states

All character material is scripted and selected by established facts, never by time or generated conversation. The four phases are before proof, after either verified DEFERRED proof, after SPOOL-02 restoration and after chapter completion. Later phases take precedence for commentary; earlier evidence remains readable. Each proof route has its own retained confirmation, even if visited second. PACKET and GHOST have only archived material: changed access selects another old note, never a new reply.

| Character | History                                                                                                         | Voice                                                                           | Motivation                                                | Knowledge boundaries                                                                                                         | State-dependent behaviour                                                                                                                                                                                                                                                                                                                                                                              | Memorable moment                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| ECHO      | Existing damaged coordinator, carrying conflicting memories of dispatch.                                        | Precise, dry, self-correcting.                                                  | Recover verified facts and usable memories.               | Cannot inspect unopened evidence, infer absent authors' lives or explain the signal's origin.                                | Before proof: marks the delivery/authorship conflict as unresolved and offers headers. After proof: cites the opened header evidence or custody confirmation, replacing the mistaken memory. After restoration: identifies readable source dependencies without claiming they are a complete program. After completion: records a verified local replay and marks UNASSIGNED's operator unknown.       | On proof: “Delivery is not authorship. I had those reversed.”                     |
| SYSOP     | Fictional local preservation routine configured during the migration; not TKEEL.                                | Terse operational warnings; permissions and custody, not personal reminiscence. | Preserve the network and original evidence.               | Knows local seals, receipts and permissions; cannot know personal intentions, author whereabouts or extraterrestrial causes. | Before proof: offers custody accounting and warns against overwriting. After proof: records preserved custody; if only headers were used, acknowledges that proof without pretending its own audit was completed. After restoration: grants MAINTAINER on a working copy, keeping originals read-only. After completion: certifies preservation of originals, withholding any claim of total recovery. | At restoration: “MAINTAINER GRANTED. ORIGINAL REMAINS READ-ONLY.”                 |
| PACKET    | Fictional former volunteer dispatch maintainer; left signed repair notes before last board presence on March 2. | Short routing shorthand, dry asides.                                            | Have messages arrive intact and receipt acknowledged.     | Notes describe only pre-departure conditions; no knowledge of the current player or later dispatch.                          | Before proof: queued repair note appears with its original signature. After proof: the accessible training shelf includes the old acknowledgement procedure. After restoration: an old module routing annotation becomes readable in the Annex. After completion: the retained receipt instruction can be viewed beside the new local receipt, explicitly separate records.                            | A delayed repair note still asks: “Acknowledge receipt. Even if it took a while.” |
| GHOST     | Fictional former archival volunteer; last board presence March 3; not a supernatural identity.                  | Spare distinctions between absence and loss.                                    | Preserve provenance, including names attached to records. | Notes know archival practice, not later events or the authors' eventual fate.                                                | Before proof: signed preservation note accompanies the disputed batch. After proof: training access reveals an old seal instruction. After restoration: Annex access reveals the provenance annotation. After completion: an archived preservation checklist is shown with the independently produced replay audit.                                                                                    | Annex annotation: “A name left on a record is not its owner still here.”          |

ECHO's wish to recover missing information can conflict with SYSOP's refusal to overwrite uncertain originals. Choosing a proof changes the cited evidence and commentary, not allegiance or access to an exclusive ending. Preserved replay meets their bounded immediate needs; their wider goals do not become identical. None of these fictional handles identifies a real contributor.

### Four-act beat sheet and access dependencies

The required route targets **24 minutes: 5 + 7 + 7 + 5**, within 20–30 minutes. This is an authored budget, not a measured playtest. It includes one investigation and one manifest door; optional alternate routes and deeper Archive puzzles are extra.

| Act                  | Place and required beats                                                                                                                                                                                                                                                                                                                                                                           | Entry and exit dependency                                                                                           | Budget |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| Act I — Incoming     | Connect to DEEP FIELD, select designation, read preserved Keel farewell and apparent post-disappearance notes. The message index links the departure ledger and queue receipt `Q17`. A damaged recovery directory lists retained source labels `queue-reader`, `signature-checker`, `replay-writer`, marked inaccessible rather than proven complete. Search Q17 to expose the investigation desk. | Episode 000 complete → board access → batch located; no FORGE predicate.                                            | 5 min  |
| Act II — Investigate | Choose ECHO's headers or SYSOP's custody desk. Either proves DEFERRED and unlocks The Forgotten Archive's training shelf. Read the three fragments, order their dependencies, and carry the learned procedure back to the main recovery console.                                                                                                                                                   | Batch located → either proof → training access → learned recovery order.                                            | 7 min  |
| Act III — Restore    | Apply the learned order to SPOOL-02 at the recovery console. Working spool access opens Maintenance Annex, grants MAINTAINER and lists Signal Hunter and Relay Trader. Read the retained fragments and build recipe; choose either door for signed manifest R07-SPOOL-02.                                                                                                                          | Proof plus learned order → restored spool → Annex/access/doors → manifest.                                          | 7 min  |
| Act IV — Reconstruct | Compare all three modules against manifest and recipe, choose REPLAY / PRESERVE, and reconstruct the local spool in a separate working copy. Verify original seals and replay receipt. The completed queue reader reveals previously unaddressed destination UNASSIGNED.                                                                                                                           | Restored spool plus complete manifest/fragments and compatible mode → chapter complete and new destination visible. | 5 min  |

Design states are monotonic: board access, batch located, header proof and/or custody proof, training access, learned order, spool restored, MAINTAINER/Annex access, manifest acquired, chapter complete. Either proof grants the same training access. Both manifest doors grant the same artifact; duplicate acquisition is harmless. Reading required evidence is part of each proof or reconstruction submission, so guessing a token before access is not a shortcut. These are future authoring requirements, not new engine code in this change.

### Exact clue chain

Each row specifies its own accessible evidence; no reward supplies its own prerequisite. Exact uppercase answers below are the canonical solutions. Wrong submissions explain the conflicting evidence without altering it; retry is unlimited. Already completed actions redisplay their result without consuming or duplicating anything.

| Transition and prerequisite                       | Visible evidence and location                                                                                                                                                                                                                                                                                       | Deduction                                                                                                            | Exact accepted answer/action                                                      | Granted state and error recovery                                                                                                                                                                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login; Episode 000 complete                       | DEEP FIELD login lists the designation awarded in Episode 000.                                                                                                                                                                                                                                                      | Reuse the existing local identity.                                                                                   | Select that designation.                                                          | Board access; backing out returns to the same prompt.                                                                                                                                                                                                |
| Locate batch; board access                        | Message index shows the two delivered notes, ledger link and “Queue receipt: Q17; search batch identifier.” Receipt is readable from the list.                                                                                                                                                                      | Both records belong to the same batch.                                                                               | Search `Q17`.                                                                     | Batch located; headers and custody desk available. Other searches retain the index and receipt.                                                                                                                                                      |
| ECHO/header proof; batch located                  | Q17 header desk contains P17/G17 write fields, delivery indexes and the departure ledger above. Queue policy states: “WRITTEN records sealed composition. DELIVERED records dispatch, not new authorship. A migration-held record released unchanged is DEFERRED.”                                                  | Both compositions precede departure; dispatch follows it.                                                            | Read those records and submit `DEFERRED`.                                         | Header proof, ECHO verified memory and training access. Wrong finding highlights the two different fields; custody remains available.                                                                                                                |
| SYSOP/custody proof; batch located                | Q17 custody desk shows sealed originals P17/G17 and dispatch copies with identical signature labels and verified equality. Hold receipt says “Q17: migration hold; sealed before departure; release unchanged after checkpoint 121.” Custody policy calls an unchanged held release `DEFERRED`.                     | Dispatch delivered preserved originals rather than new writing or substituted authors.                               | Read originals, comparison and receipt; submit `DEFERRED`.                        | Custody proof, SYSOP custody confirmation and the same training access. Errors retain originals and highlight the mismatch with the receipt; headers remain available.                                                                               |
| Learn procedure; either proof                     | The Forgotten Archive training shelf has labelled fragments: SEAL fixes an immutable original and issues a seal reference; ROUTE requires that reference and issues a destination receipt; ACK requires that receipt and records delivery. Posted dependency rule: no operation can use an output not yet produced. | Only sealing before routing before acknowledgement satisfies all dependencies.                                       | Inspect all three fragments and submit `SEAL / ROUTE / ACK`.                      | Learned recovery order, retained in the door notebook. Wrong order names the missing input; fragments stay readable.                                                                                                                                 |
| Restore node; either proof and learned order      | Main recovery console explicitly names SPOOL-02, offers SEAL, ROUTE and ACK operations, and requests the training shelf procedure. Target card says “restore working spool; retain sealed originals.” It gives no ordering rules.                                                                                   | Transfer door-derived knowledge to the named local node.                                                             | Apply `SEAL / ROUTE / ACK` to SPOOL-02.                                           | Spool restored; Maintenance Annex, MAINTAINER, Signal Hunter and Relay Trader unlock together. Incorrect order performs no partial destructive operation; retry or revisit the shelf. Without learned order, even a guessed sequence cannot restore. |
| Hunter manifest; restored spool                   | Signal Hunter entry request names R07-SPOOL-02 and requires node SPOOL-02 plus intact signature. Three local trace cards: H1 `RELAY-07 / INTACT` (relay-only index, no spool manifest); H2 `SPOOL-02 / DAMAGED` (failed signature); H3 `SPOOL-02 / INTACT` (verified R07-SPOOL-02).                                 | Only H3 meets both node and integrity requirements.                                                                  | Choose `SPOOL-02 / INTACT`.                                                       | Manifest R07-SPOOL-02 acquired; rejected candidates state which requirement fails; Trader remains available.                                                                                                                                         |
| Trader envelope; restored spool                   | Relay Trader entry lists station NULL QUAY and its posted rule: “One repair manifest for proof of receipt, not value. Empty acknowledgement envelope reserved free for this Observer. Stamp ACK plus target node.” Target requisition names SPOOL-02 and manifest R07-SPOOL-02.                                     | Receipt, rather than currency or cargo, is the exchange item.                                                        | At NULL QUAY, claim the free reserved empty acknowledgement envelope.             | Envelope held; revisits return the held envelope, with no price, stock roll or replenishment.                                                                                                                                                        |
| Trader manifest; envelope held                    | NULL QUAY stamp desk has the same posted rule and SPOOL-02 requisition; exchange desk shows reward R07-SPOOL-02.                                                                                                                                                                                                    | Acknowledge that exact spool, then exchange once.                                                                    | Stamp `ACK SPOOL-02`; exchange the stamped envelope once.                         | Same manifest acquired, exchange receipt retained. Wrong stamp can be corrected freely before exchange. Repeating a completed exchange shows its receipt; Hunter remains available.                                                                  |
| Reconstruct; restored spool and manifest acquired | Maintenance Annex holds the three retained fragments, build recipe, manifest and compatibility table specified below.                                                                                                                                                                                               | All required modules exist, in dependency order; only replay with preservation satisfies the signed repair contract. | Inspect and compare all three modules and the recipe; submit `REPLAY / PRESERVE`. | Chapter complete; separate replay copy and audit, originals unchanged, UNASSIGNED revealed. Incomplete comparisons or wrong mode keep evidence and access for retry. Repeating completion shows the existing audit.                                  |

### Door contracts

**The Forgotten Archive** is a new named BBS door, distinct from Episode 000's existing Archive location. Either investigation unlocks its short, local training shelf for every player. GHOST's seal fragment, the routing fragment and PACKET's acknowledgement fragment contain the complete dependency rules in the clue table. No optional deeper puzzle gates that shelf. The shelf notebook retains the learned procedure for return to the main console. The board supplies the target and operation labels, never a duplicate ordering lesson or a bypass. Removing shelf knowledge stops restoration; restoring it makes the main path possible.

**Signal Hunter** is a bounded evidence comparison, not a search over generated signals. The three trace cards and target request are available together on entry, locally, without timers or real-time checks. Node identity alone rejects H1 but cannot distinguish H2/H3; signature integrity rejects H2. H3 alone yields the signed spool manifest. No Trader item is needed. Optional additional hunting does not improve or gate this reward.

**Relay Trader** is a bounded receipt transaction. The unusual item is an **empty acknowledgement envelope**, reserved free at **NULL QUAY**. It has no scarcity or resale value: the station wants proof that this spool's repair instructions were received. Claim, stamp ACK SPOOL-02, exchange once. No money, inventory grind, random stock, repeated trades or Hunter completion is required. An abandoned or mistamped envelope is recoverable/correctable without cost. Exchanging consumes only this replaceable transaction wrapper, never story evidence; the permanent receipt prevents a second required exchange.

A player may leave either manifest door at any point, keep their progress and finish through the other. If the manifest is already acquired, either door can display the same signed artifact without another trade. No other player, account, network call or token is required for any door. The selected route affects its local commentary only.

### Reconstruction proof and earned ending

Act I's directory seeds the three source labels without promising completeness. In Act III, the restored Annex exposes retained source fragments with complete local module boundaries and verified seals, plus this build recipe: signature-checker verifies stored records; queue-reader depends on signature-checker to admit only verified records; replay-writer depends on queue-reader and signature-checker to write a separate replay copy. Reading source is evidence inspection, not a requirement to program or execute arbitrary player code.

Manifest **R07-SPOOL-02**, signed and verified by either door, names target SPOOL-02 and exactly these required modules:

| Manifest module     | Retained Annex fragment | Required dependency and completeness evidence                                          |
| ------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `signature-checker` | SC-1                    | No module prerequisite; full module boundary and seal match the manifest's SC-1 entry. |
| `queue-reader`      | QR-1                    | Requires SC-1; full module boundary and seal match QR-1.                               |
| `replay-writer`     | RW-1                    | Requires QR-1 and SC-1; full module boundary and seal match RW-1.                      |

The recipe orders SC-1 → QR-1 → RW-1. The manifest declares that these three complete modules are sufficient for the local spool repair, with no missing fourth module or external download. It requires a separate replay destination and unchanged sealed originals. The Annex compatibility table makes the final choice deducible:

| Operation / evidence mode | Local repair result                                                                          | Contract compatibility                              |
| ------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `REPLAY / PRESERVE`       | Reconstructs readable dispatch in a separate copy; original signatures and records retained. | Compatible: restores access and preserves evidence. |
| `REPLAY / REPLACE`        | Reconstructs dispatch over the originals.                                                    | Incompatible: loses the original custody record.    |
| `RESET / PRESERVE`        | Keeps originals but produces an empty working spool.                                         | Incompatible: no recovered dispatch.                |
| `RESET / REPLACE`         | Clears working and original records.                                                         | Incompatible with both requirements.                |

`REPLAY / PRESERVE` is the sole final answer. Completion compares preserved P17/G17 seals to the pre-repair records and emits a local replay receipt: the queued notes were composed before disappearance and delivered later under migration hold. This resolves the chapter's apparent new messages explicitly. ECHO gains a cited recovered fact; SYSOP confirms originals remain read-only. Recoverable local network software is now proven by the complete manifest, retained modules and successful bounded reconstruction, not by ECHO's assertion alone. It does not prove full-network recovery or explain the invitation.

Only after that resolution does the reconstructed queue reader expose **UNASSIGNED**, a previously unaddressed destination in the retained routing table. Its destination slot is prepared but its registered-operator field is empty; the table has no author credit. The next mystery is precise: **who prepared a destination with no registered operator?** This is not an incoming live person, a second Observer, the signal's identified source or an Observatory unlock. Its creator and purpose are deliberate future unknowns, not missing answers to this chapter's required puzzles.

### Attribution and reality boundary

Keep the optional METER TRACE → service code 7-0-9 → FORGE discovery unchanged. Chapter 2 works from both FORGE states and never asks the player to visit a repository, contribute, or treat community content as a required clue.

An optional, visibly out-of-world attribution panel may explain how signed additions enter the shipped game: a real submission is checked and independently reviewed before inclusion; no unreviewed submission becomes canon automatically. Real author/handle/source-PR credits belong only in that attribution context, separate from fictional message handles, signatures and authored timestamps. Do not invent contributors or source PRs. The shipped community package remains explicitly labelled an example, not evidence of a current player or a live posting system. This specifies a review boundary, not final panel UI or dialogue.

All completion evidence ships locally. No live AI, runtime GitHub API, real community statistics, contribution requirement or service credential is part of the story solution.
