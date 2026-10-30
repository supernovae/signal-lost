export interface MenuItem {
  key: string;
  label: string;
  run(): void;
}

export interface Terminal {
  print(lines: readonly string[], tone?: 'normal' | 'dim' | 'alert'): void;
  menu(items: readonly MenuItem[]): void;
  onCommand(handler: (command: string) => void): void;
  focus(): void;
  /** Opens the tool panel, replacing any open tool. */
  openPanel(): HTMLElement;
  closePanel(): void;
  dispose(): void;
}

/** A retro terminal built from real DOM text, so it stays readable and accessible. */
export function createTerminal(root: HTMLElement): Terminal {
  const element = document.createElement('section');
  element.className = 'terminal';
  element.setAttribute('aria-label', 'Terminal');

  const log = document.createElement('div');
  log.className = 'terminal-log';
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  log.tabIndex = 0;

  const nav = document.createElement('nav');
  nav.className = 'terminal-menu';
  nav.setAttribute('aria-label', 'Tools');

  const form = document.createElement('form');
  form.className = 'terminal-prompt';
  const caret = document.createElement('label');
  caret.textContent = 'OBS>';
  caret.htmlFor = 'terminal-input';
  const input = document.createElement('input');
  input.id = 'terminal-input';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'characters');
  form.append(caret, input);

  const panel = document.createElement('section');
  panel.className = 'tool-panel';
  panel.hidden = true;

  element.append(log, panel, nav, form);
  root.append(element);

  let handler: (command: string) => void = () => {};
  let items: readonly MenuItem[] = [];

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const command = input.value.trim();
    input.value = '';
    if (!command) return;
    const line = document.createElement('p');
    line.className = 'dim';
    line.textContent = `OBS> ${command}`;
    log.append(line);
    const match = items.find(
      (item) => item.key === command || item.label.toUpperCase() === command.toUpperCase(),
    );
    if (match) match.run();
    else handler(command);
    log.scrollTop = log.scrollHeight;
  });

  return {
    print(lines, tone = 'normal') {
      for (const text of lines) {
        const line = document.createElement('p');
        if (tone !== 'normal') line.className = tone;
        line.textContent = text || ' ';
        log.append(line);
      }
      log.scrollTop = log.scrollHeight;
    },
    menu(next) {
      items = next;
      nav.replaceChildren(
        ...next.map((item) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = `[${item.key}] ${item.label}`;
          button.addEventListener('click', () => {
            item.run();
            log.scrollTop = log.scrollHeight;
          });
          return button;
        }),
      );
    },
    onCommand(next) {
      handler = next;
    },
    focus: () => input.focus(),
    openPanel() {
      panel.replaceChildren();
      panel.hidden = false;
      document.body.dataset['tool'] = 'open';
      return panel;
    },
    closePanel() {
      panel.replaceChildren();
      panel.hidden = true;
      delete document.body.dataset['tool'];
    },
    dispose() {
      delete document.body.dataset['tool'];
      element.remove();
    },
  };
}
