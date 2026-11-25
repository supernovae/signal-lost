import { expect, it } from 'vitest';
import { readContentDir } from '../src/content/node.ts';
import { formatErrors, validateDoorById } from '../src/content/validate.ts';
import { createDoorAuthoringHost } from '../src/doors/authoring.ts';

it('validates, launches and checkpoints the selected door on EXIT', async () => {
  const id = process.env['SIGNAL_LOST_DOOR_ID'];
  const content = process.env['SIGNAL_LOST_DOOR_CONTENT'];
  if (!id || !content) throw new Error('Run this smoke test with npm run door:check.');

  const selection = validateDoorById(readContentDir(content), id);
  if (selection.kind === 'error') throw new Error(formatErrors(selection.errors));

  const host = createDoorAuthoringHost(selection);
  const result = await host.launch(id);
  expect(result.kind, `could not launch door "${id}"`).toBe('screen');
  if (result.kind !== 'screen') return;
  expect(result.screen.lines.some((line) => line.trim() !== '')).toBe(true);
  for (const { command, label } of result.screen.actions) {
    expect(command.trim()).not.toBe('');
    expect(label.trim()).not.toBe('');
  }
  expect(host.exit()).toEqual({ kind: 'exit', returnTo: 'bbs-menu' });
});
