import { createTerminal, type Terminal } from '../terminal/terminal.ts';
import type { Scene } from './scenes.ts';

export interface Tool {
  id: string;
  label: string;
  run(terminal: Terminal, refresh: () => void): void;
}

export function createHub(
  root: HTMLElement,
  boot: readonly string[],
  tools: () => readonly Tool[],
): Scene {
  let terminal: Terminal | undefined;
  return {
    mount() {
      document.body.dataset['scene'] = 'hub';
      const active = createTerminal(root);
      terminal = active;
      active.print(boot);
      const refresh = (): void => {
        active.menu(
          tools().map((tool, index) => ({
            key: String(index + 1),
            label: tool.label,
            run() {
              active.closePanel();
              tool.run(active, refresh);
              refresh();
            },
          })),
        );
      };
      refresh();
      active.onCommand((command) => {
        active.print([`UNKNOWN COMMAND: ${command}. TYPE A TOOL NUMBER OR NAME.`], 'alert');
      });
      active.focus();
    },
    dispose() {
      terminal?.dispose();
    },
  };
}
