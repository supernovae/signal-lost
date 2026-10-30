import { createHub, type Tool } from './app/hub.ts';
import { createOpening } from './app/opening.ts';
import { createSceneManager } from './app/scenes.ts';
import { loadBundledContent } from './content/browser.ts';
import { createRenderHost } from './render/host.ts';
import { openAnalyzer } from './signal/analyzer-view.ts';
import './style.css';

const root = document.querySelector<HTMLElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#viewscreen')!;
const { content } = loadBundledContent();
const screen = (id: string): readonly string[] =>
  content.screens.find((s) => s.id === id)?.lines ?? [];

const motion = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const renderHost = createRenderHost(
  async () => {
    const { createEnvironment } = await import('./render/environment.ts');
    const environment = createEnvironment(canvas, { motion });
    document.body.dataset['render'] = 'webgl';
    return environment;
  },
  () => {
    document.body.dataset['render'] = 'fallback';
  },
);
window.addEventListener('pagehide', () => renderHost.dispose());

const tools: Tool[] = [
  {
    id: 'status',
    label: 'STATUS',
    run: (terminal) => terminal.print(['LINK: ONE-WAY', 'OBSERVERS ONLINE: 1'], 'dim'),
  },
  {
    id: 'help',
    label: 'HELP',
    run: (terminal) => terminal.print(['TYPE A TOOL NUMBER OR NAME, OR SELECT IT.'], 'dim'),
  },
];

for (const puzzle of content.puzzles) {
  if (puzzle.kind !== 'carrier') continue;
  tools.unshift({
    id: puzzle.id,
    label: 'ANALYZER',
    run(terminal) {
      terminal.print(puzzle.briefing);
      openAnalyzer(terminal.openPanel(), puzzle, ({ outcome }) => {
        if (outcome === 'locked') {
          terminal.print(puzzle.success);
          terminal.closePanel();
        } else {
          const feedback = {
            terrestrial: puzzle.feedback.terrestrial,
            weak: puzzle.feedback.weak,
            'no-line': puzzle.feedback.noLine,
          };
          terminal.print(feedback[outcome], 'alert');
        }
      });
    },
  });
}

const scenes = createSceneManager();
scenes.show(
  createOpening(root, screen('opening'), () => {
    scenes.show(createHub(root, screen('boot'), tools));
  }),
);
