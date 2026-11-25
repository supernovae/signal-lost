import { openDoorPreview } from './door-preview-session.ts';
import type { DoorScreen } from '../doors/contract.ts';
import { createTerminal } from '../terminal/terminal.ts';
import '../style.css';

const rawContent = import.meta.glob<string>('/content/**/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const terminal = createTerminal(document.getElementById('app')!, 'DOOR>');
const preview = await openDoorPreview(window.location.search, rawContent);

if (preview.kind === 'error') {
  terminal.print(preview.lines, 'alert');
} else {
  const { host } = preview;

  function dispatch(command: string): void {
    const result = command.trim().toUpperCase() === 'EXIT' ? host.exit() : host.input(command);
    if (result.kind === 'screen') {
      show(result.screen);
      return;
    }
    terminal.menu([]);
    terminal.onCommand(() => {});
    if (result.kind === 'exit') {
      terminal.print(['Door exited. Reload the page to start a fresh preview.']);
    } else {
      terminal.print(['The door session ended with an error.'], 'alert');
    }
  }

  function show(screen: DoorScreen): void {
    terminal.print(screen.lines, 'door');
    terminal.menu(
      [...screen.actions, { command: 'EXIT', label: 'Exit' }].map(({ command, label }) => ({
        key: command,
        label,
        run: () => dispatch(command),
      })),
    );
    terminal.focus();
  }

  terminal.onCommand(dispatch);
  show(preview.screen);
}
