import type { Puzzle } from '../content/schema.ts';
import type { LockOutcome } from '../signal/lock.ts';

export type Answer =
  | { kind: 'carrier'; outcome: LockOutcome }
  | { kind: 'raster'; width: number; reference: string }
  | { kind: 'inquiry'; fields: Record<string, string> }
  | { kind: 'code'; code: string };

export interface Evaluation {
  correct: boolean;
  feedback: readonly string[];
  /** Inquiry only: how many fields agree. Never which ones. */
  consistent?: number;
}

export function normalize(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function evaluateAnswer(puzzle: Puzzle, answer: Answer): Evaluation {
  if (puzzle.kind !== answer.kind) {
    throw new Error(`${puzzle.id} is a ${puzzle.kind} puzzle, not ${answer.kind}`);
  }
  switch (answer.kind) {
    case 'carrier': {
      const carrier = puzzle as Extract<Puzzle, { kind: 'carrier' }>;
      if (answer.outcome === 'locked') return { correct: true, feedback: puzzle.success };
      const feedback = {
        terrestrial: carrier.feedback.terrestrial,
        weak: carrier.feedback.weak,
        'no-line': carrier.feedback.noLine,
      };
      return { correct: false, feedback: feedback[answer.outcome] };
    }
    case 'raster': {
      const raster = puzzle as Extract<Puzzle, { kind: 'raster' }>;
      if (answer.width !== raster.solution.width) {
        return { correct: false, feedback: raster.feedback.width };
      }
      const given = normalize(answer.reference);
      if (given === normalize(raster.solution.answer)) {
        return { correct: true, feedback: puzzle.success };
      }
      const known = raster.knownWrong.find((wrong) => normalize(wrong.answer) === given);
      return { correct: false, feedback: known?.feedback ?? raster.feedback.answer };
    }
    case 'inquiry': {
      const inquiry = puzzle as Extract<Puzzle, { kind: 'inquiry' }>;
      const consistent = inquiry.fields.filter(
        (field) => normalize(answer.fields[field.id] ?? '') === normalize(field.answer),
      ).length;
      const correct = consistent === inquiry.fields.length;
      return { correct, feedback: correct ? puzzle.success : [], consistent };
    }
    case 'code': {
      const code = puzzle as Extract<Puzzle, { kind: 'code' }>;
      const correct = normalize(answer.code) === normalize(code.answer);
      return { correct, feedback: correct ? puzzle.success : code.feedback };
    }
  }
}
