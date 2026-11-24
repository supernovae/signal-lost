import type { Scene } from '../app/scenes.ts';
import { createTerminal, type Terminal } from '../terminal/terminal.ts';
import { bbsCopy } from './copy.ts';
import type { BbsDoorSession } from './door-session.ts';
import type { BbsEffect, BbsSnapshot } from './progress.ts';

const { tones, text } = bbsCopy;

export function createBbsScene(
  root: HTMLElement,
  bbs: BbsDoorSession,
  snapshot: () => BbsSnapshot,
  onEffect: (effect: BbsEffect) => boolean,
  onSettings: (terminal: Terminal) => void,
  onDisconnect: () => void,
): Scene {
  let terminal: Terminal | undefined;

  return {
    mount() {
      document.body.dataset['scene'] = 'bbs';
      const active = createTerminal(root, text.prompt);
      terminal = active;
      let handleInput: HTMLInputElement | undefined;
      let settingsOpen = false;
      let pending = false;

      async function run(command: string, fromHandleForm = false): Promise<void> {
        if (pending) return;
        pending = true;
        try {
          const result = await bbs.dispatch(command);
          if (!result || terminal !== active) return;
          const { output, effect, opensSettings } = result;
          const saved = !effect || onEffect(effect);
          const { phase, actions, hint } = bbs.screen();
          if (phase === 'offline') {
            onDisconnect();
            return;
          }
          if (!opensSettings && (settingsOpen || (phase !== 'login' && handleInput))) {
            active.closePanel();
            settingsOpen = false;
            handleInput = undefined;
          }
          active.menu(
            actions.map(({ command, label, selected, disabled }) => ({
              key: command,
              showKey: /^(READ|OPEN) /.test(command) || (phase === 'door' && command !== 'EXIT'),
              label,
              acceptLabel: false,
              selected,
              disabled,
              run:
                phase === 'login' && command === 'LOGIN' ? openHandleForm : () => void run(command),
            })),
          );
          for (const block of output) {
            active.print([tones[block.tone], ...block.lines], block.tone, block);
          }
          if (output.length && output.at(-1)?.tone !== 'system' && phase !== 'door') {
            active.print([hint], 'dim');
          }
          if (!saved) active.print([tones['network-error'], text.saveRefused], 'network-error');
          if (opensSettings) {
            settingsOpen = true;
            onSettings(active);
          } else if (fromHandleForm && handleInput) handleInput.focus();
          else active.focus();
        } finally {
          pending = false;
        }
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
        label.textContent = text.handle;
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'bbs-handle';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('autocapitalize', 'off');
        input.value = snapshot().profile.handle ?? '';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = text.signIn;
        form.append(label, input, submit);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          void run(`LOGIN ${input.value}`, true);
        });
        panel.append(form);
        handleInput = input;
        input.focus();
      }

      active.onCommand(run);
      void run('CONNECT').then(() => {
        if (terminal === active) active.print([bbs.screen().hint], 'dim');
      });
    },
    dispose() {
      terminal?.dispose();
      terminal = undefined;
    },
  };
}
