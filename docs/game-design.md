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

**Optional discovery:** Relay 07's power ledger repeats a pattern. Reading it as marks from the manual gives a service code for the panel. That unlocks **FORGE**, a partly working terminal that says the network accepts new transmissions from Observers who sign their work, and points to where they are filed: the real repository. ECHO then notices that one archived transmission was not written by anyone it remembers.

## Tone

Clipped, technical, and human at the edges. People in the logs are tired volunteers, not movie scientists. Humour is dry. Nothing explains more than it has to.
