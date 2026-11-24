import { z } from 'zod';
import type { TriviaDoor } from '../content/schema.ts';
import { defineDoor, type DoorScreen } from './contract.ts';

export function createTriviaDoor({ name, questions, success, saveState, completion }: TriviaDoor) {
  const schema = { 'question-index': z.number().int().min(0).max(questions.length) }[saveState];
  const isComplete = { 'all-correct': (saved: number) => saved === questions.length }[completion];

  function show(state: number, feedback: readonly string[] = []) {
    const question = questions[state];
    const screen: DoorScreen = question
      ? {
          lines: [
            name,
            ...feedback,
            ...question.prompt,
            ...question.options.map((option, index) => `${index + 1}. ${option}`),
          ],
          actions: question.options.map((label, index) => ({ command: String(index + 1), label })),
        }
      : { lines: [name, ...success], actions: [] };
    return { state, screen };
  }

  return defineDoor({
    saveState: schema,
    launch: () => show(0),
    restore: (saved) => show(saved),
    input(state, command) {
      const question = questions[state];
      if (!question) return show(state);
      return command.trim() === String(question.answer + 1)
        ? show(state + 1)
        : show(state, question.retry);
    },
    exit() {},
    save: (state) => state,
    isComplete,
  });
}
