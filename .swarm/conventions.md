# Engineering Conventions

- TypeScript strict mode, ES modules, explicit `.ts` import extensions so scripts run under Node's type stripping. No `enum` or other non-erasable syntax.
- Keep changes minimal, atomic, and tested. Test behaviour through public module functions; browser tests drive the real UI by role and text.
- Puzzle and signal behaviour must be deterministic: use the seeded generator, never `Math.random` or the clock, in anything that affects progress.
- Player-facing text belongs in `content/`, except for fixed interface labels.
- UI must stay keyboard-operable, readable, and honest: never present fictional numbers as real community statistics, and never describe scripted ECHO dialogue as live AI.
