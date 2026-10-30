import type { Scene } from './scenes.ts';

const LINE_DELAY_MS = 700;

export function createEnding(
  root: HTMLElement,
  lines: readonly string[],
  footer: readonly string[],
  animate: boolean,
  onDone: () => void,
): Scene {
  let element: HTMLElement | undefined;
  const timers: number[] = [];
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') onDone();
  };

  return {
    mount() {
      document.body.dataset['scene'] = 'ending';
      element = document.createElement('section');
      element.className = 'ending';
      const log = document.createElement('div');
      log.setAttribute('role', 'log');
      log.setAttribute('aria-live', 'polite');
      const add = (text: string): void => {
        const line = document.createElement('p');
        line.textContent = text || ' ';
        log.append(line);
        log.scrollTop = log.scrollHeight;
      };
      const proceed = document.createElement('button');
      proceed.type = 'button';
      proceed.textContent = 'CONTINUE';
      proceed.addEventListener('click', onDone);
      element.append(log, proceed);
      root.append(element);
      document.addEventListener('keydown', onKey);
      proceed.focus();

      const all = [...lines, '', ...footer];
      if (!animate) {
        all.forEach(add);
        return;
      }
      all.forEach((text, index) => {
        timers.push(window.setTimeout(() => add(text), index * LINE_DELAY_MS));
      });
    },
    dispose() {
      timers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener('keydown', onKey);
      element?.remove();
    },
  };
}
