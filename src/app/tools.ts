import type { GameAudio } from '../audio/audio.ts';
import { evaluate } from '../content/conditions.ts';
import type { Content, Episode, Puzzle, Transmission } from '../content/schema.ts';
import type { DialogueSource } from '../narrative/dialogue.ts';
import type { AttemptResult, Game } from '../puzzle/game.ts';
import { openDecoder } from '../puzzle/raster-view.ts';
import { openInquiry } from '../puzzle/inquiry-view.ts';
import { openAnalyzer } from '../signal/analyzer-view.ts';
import type { Terminal } from '../terminal/terminal.ts';
import { openArchive } from '../world/archive-view.ts';
import { openArtifact } from '../world/artifact-view.ts';
import { mapNodes, type MapNode } from '../world/map.ts';
import { openMap } from '../world/map-view.ts';
import { openCodePanel } from '../world/sector-view.ts';
import type { Tool } from './hub.ts';

export interface ToolContext {
  content: Content;
  game: Game;
  audio: GameAudio;
  echo: DialogueSource;
  /** Extra tools with no puzzle behind them, such as settings. */
  utilities: readonly Tool[];
  onEpisodeComplete(episode: Episode): void;
}

const PUZZLE_LABELS: Record<Puzzle['kind'], string | undefined> = {
  carrier: 'ANALYZER',
  raster: 'DECODER',
  inquiry: 'INQUIRY',
  code: undefined,
};

/** Reports an attempt and everything that follows from it. */
export function reportAttempt(
  context: ToolContext,
  terminal: Terminal,
  refresh: () => void,
  result: AttemptResult,
): void {
  const { game, audio, echo, content } = context;
  const solved = result.status === 'solved';
  if (result.feedback.length > 0) terminal.print(result.feedback, solved ? 'normal' : 'alert');
  audio.play(solved ? 'success' : 'error');
  if (!solved) return;
  terminal.closePanel();
  const reaction = game.say(echo, 'reaction');
  if (reaction) terminal.print(reaction.text);
  refresh();
  const finished = content.episodes.find((e) => result.granted.includes(`completed:${e.id}`));
  if (finished) context.onEpisodeComplete(finished);
}

function puzzleTool(context: ToolContext, puzzle: Puzzle): Tool | undefined {
  const label = PUZZLE_LABELS[puzzle.kind];
  if (!label) return undefined;
  const { game, audio } = context;
  return {
    id: puzzle.id,
    label,
    run(terminal, refresh) {
      if (game.isSolved(puzzle.id)) {
        terminal.print(puzzle.success, 'dim');
        return;
      }
      terminal.print(puzzle.briefing);
      const panel = terminal.openPanel();
      const report = (result: AttemptResult): void =>
        reportAttempt(context, terminal, refresh, result);
      if (puzzle.kind === 'carrier') {
        openAnalyzer(
          panel,
          puzzle,
          ({ outcome }) => report(game.attempt(puzzle.id, { kind: 'carrier', outcome })),
          () => audio.play('interference'),
        );
      } else if (puzzle.kind === 'raster') {
        openDecoder(panel, puzzle, (width, reference) =>
          report(game.attempt(puzzle.id, { kind: 'raster', width, reference })),
        );
      } else if (puzzle.kind === 'inquiry') {
        openInquiry(panel, puzzle, (fields) => {
          const result = game.attempt(puzzle.id, { kind: 'inquiry', fields });
          if (result.consistent !== undefined && result.status === 'wrong') {
            const total = puzzle.fields.length;
            terminal.print([`${result.consistent} OF ${total} FIELDS CONSISTENT.`], 'alert');
          }
          report(result);
        });
      }
    },
  };
}

function filedBy({ attribution }: Transmission): string | undefined {
  if (!attribution) return undefined;
  const handle = attribution.handle ? ` (${attribution.handle})` : '';
  return `FILED BY: ${attribution.author}${handle}`;
}

function archiveTool(context: ToolContext, terminal: Terminal, refresh: () => void): void {
  const { game, echo } = context;
  openArchive(terminal.openPanel(), game.archives, (archive) => {
    const added = game.grant([`read:${archive.id}`]);
    if (added.length > 0) {
      const reaction = game.say(echo, 'reaction');
      if (reaction) terminal.print(reaction.text);
    }
    refresh();
  });
}

function enterSector(
  context: ToolContext,
  terminal: Terminal,
  refresh: () => void,
  { sector, enterable }: MapNode,
): void {
  const { game, echo } = context;
  terminal.print([sector.name], 'dim');
  if (!enterable) {
    terminal.print(sector.lockedText, 'alert');
    return;
  }
  terminal.print(sector.description);
  if (game.grant(sector.grantsOnEnter).length > 0) {
    const reaction = game.say(echo, 'reaction');
    if (reaction) terminal.print(reaction.text);
  }
  if (sector.opens === 'archive') {
    archiveTool(context, terminal, refresh);
  } else if (sector.puzzle && game.isAvailable(sector.puzzle)) {
    const puzzleId = sector.puzzle;
    if (game.isSolved(puzzleId)) {
      terminal.print(game.puzzle(puzzleId).success, 'dim');
    } else {
      openCodePanel(terminal.openPanel(), (code) => {
        reportAttempt(context, terminal, refresh, game.attempt(puzzleId, { kind: 'code', code }));
      });
    }
  }
  refresh();
}

export function buildTools(context: ToolContext): Tool[] {
  const { content, game, echo } = context;
  const tools: Tool[] = [];
  for (const episode of content.episodes) {
    for (const id of episode.puzzles) {
      if (!game.isAvailable(id)) continue;
      const tool = puzzleTool(context, game.puzzle(id));
      if (tool) tools.push(tool);
    }
  }
  if (game.archives().length > 0) {
    tools.push({
      id: 'archive',
      label: 'ARCHIVE',
      run: (terminal, refresh) => archiveTool(context, terminal, refresh),
    });
  }
  if (game.transmissions().length > 0) {
    tools.push({
      id: 'transmissions',
      label: 'TRANSMISSIONS',
      run(terminal) {
        for (const transmission of game.transmissions()) {
          terminal.print([transmission.title], 'dim');
          terminal.print(transmission.body);
          const credit = filedBy(transmission);
          if (credit) terminal.print([credit], 'dim');
        }
      },
    });
  }
  if (mapNodes(content.sectors, game.facts()).length > 0) {
    tools.push({
      id: 'map',
      label: 'NETWORK MAP',
      run(terminal, refresh) {
        openMap(terminal.openPanel(), mapNodes(content.sectors, game.facts()), (node) => {
          terminal.closePanel();
          enterSector(context, terminal, refresh, node);
        });
      },
    });
  }
  for (const artifact of content.artifacts) {
    if (!evaluate(artifact.requires, game.facts())) continue;
    tools.push({
      id: artifact.id,
      label: artifact.name,
      run(terminal, refresh) {
        terminal.print(artifact.description);
        openArtifact(terminal.openPanel(), artifact);
        if (game.grant(artifact.grantsOnOpen).length > 0) {
          const reaction = game.say(echo, 'reaction');
          if (reaction) terminal.print(reaction.text);
        }
        refresh();
      },
    });
  }
  tools.push(
    {
      id: 'echo',
      label: 'ECHO',
      run(terminal) {
        const line = game.say(echo, 'hint') ?? game.say(echo, 'idle');
        if (line) terminal.print(line.text);
      },
    },
    ...context.utilities,
  );
  return tools;
}
