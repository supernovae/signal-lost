import type { Scene } from '../app/scenes.ts';
import { createTerminal, type Terminal } from '../terminal/terminal.ts';
import { createBbs, type BbsEffect, type BbsTone } from './bbs.ts';

const labels: Record<BbsTone, string> = {
  system: 'SYSTEM',
  history: 'HISTORICAL MESSAGE',
  sysop: 'SYSOP',
};

export function createBbsScene(
  root: HTMLElement,
  offer: Parameters<typeof createBbs>[0],
  identity: Parameters<typeof createBbs>[1],
  onEffect: (effect: BbsEffect) => void,
  onDisconnect: () => void,
): Scene {
  let terminal: Terminal | undefined;

  return {
    mount() {
      document.body.dataset['scene'] = 'bbs';
      const active = createTerminal(root, 'BBS>');
      terminal = active;
      const bbs = createBbs(offer, identity);
      let handleInput: HTMLInputElement | undefined;

      function run(command: string, fromHandleForm = false): void {
        const { output, effect } = bbs.dispatch(command);
        if (effect) onEffect(effect);
        const { phase, actions, hint } = bbs.screen();
        if (phase === 'offline') {
          onDisconnect();
          return;
        }
        if (phase !== 'login' && handleInput) {
          active.closePanel();
          handleInput = undefined;
        }
        active.menu(
          actions.map(({ command, label }) => ({
            key: command.startsWith('READ ') ? command : undefined,
            label,
            run: command === 'LOGIN' ? openHandleForm : () => run(command),
          })),
        );
        active.print([labels[output.tone], ...output.lines], output.tone);
        if (output.tone !== 'system') active.print([hint], 'dim');
        if (fromHandleForm && handleInput) handleInput.focus();
        else active.focus();
      }

      function openHandleForm(): void {
        if (handleInput) {
          handleInput.focus();
          return;
        }
        const panel = active.openPanel();
        const form = document.createElement('form');
        form.className = 'bbs-handle';
        const label = document.createElement('label');
        label.htmlFor = 'bbs-handle';
        label.textContent = 'FICTIONAL HANDLE';
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'bbs-handle';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('autocapitalize', 'off');
        input.value = identity.handle ?? '';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'SIGN IN';
        form.append(label, input, submit);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          run(`LOGIN ${input.value}`, true);
        });
        panel.append(form);
        handleInput = input;
        input.focus();
      }

      active.onCommand(run);
      run('CONNECT');
      active.print([bbs.screen().hint], 'dim');
    },
    dispose() {
      terminal?.dispose();
      terminal = undefined;
    },
  };
}
