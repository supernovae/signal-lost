import type { Scene } from './scenes.ts';

const LINE_DELAY_MS = 450;

export function createOpening(
  root: HTMLElement,
  lines: readonly string[],
  onJoin: () => void,
): Scene {
  let element: HTMLElement | undefined;
  const timers: number[] = [];

  const join = (): void => onJoin();
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') join();
  };

  return {
    mount() {
      document.body.dataset['scene'] = 'opening';
      element = document.createElement('button');
      element.className = 'opening';
      element.setAttribute('aria-label', 'Join the network');
      const log = document.createElement('div');
      log.setAttribute('role', 'log');
      log.setAttribute('aria-live', 'polite');
      element.append(log);
      element.addEventListener('click', join);
      root.append(element);
      document.addEventListener('keydown', onKey);

      lines.forEach((text, index) => {
        timers.push(
          window.setTimeout(() => {
            const line = document.createElement('p');
            line.textContent = text || ' ';
            if (index === lines.length - 1) line.className = 'blink';
            log.append(line);
          }, index * LINE_DELAY_MS),
        );
      });
    },
    dispose() {
      timers.forEach((timer) => window.clearTimeout(timer));
      document.removeEventListener('keydown', onKey);
      element?.remove();
    },
  };
}
