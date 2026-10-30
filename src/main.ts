import { createHub, type Tool } from './app/hub.ts';
import { createOpening } from './app/opening.ts';
import { applyPreferences, effectiveMotion, openSettings } from './app/settings.ts';
import { createSceneManager } from './app/scenes.ts';
import { loadBundledContent } from './content/browser.ts';
import { createAudio } from './audio/audio.ts';
import { createScriptedDialogue } from './narrative/dialogue.ts';
import { loadSave, resetSave, writeSave } from './progress/save.ts';
import { createGame } from './puzzle/game.ts';
import { createRenderHost } from './render/host.ts';
import { openAnalyzer } from './signal/analyzer-view.ts';
import './style.css';

const root = document.querySelector<HTMLElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#viewscreen')!;
const { content } = loadBundledContent();
const screen = (id: string): readonly string[] =>
  content.screens.find((s) => s.id === id)?.lines ?? [];

const { data } = loadSave(localStorage);
const game = createGame({
  content,
  data,
  persist: (latest) => writeSave(localStorage, latest),
  designationSeed: () => crypto.getRandomValues(new Uint32Array(1))[0]!,
});
const echo = createScriptedDialogue(content.characters.find((c) => c.id === 'echo')!);

const audio = createAudio();
const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const applySettings = (): void => {
  applyPreferences(data.preferences, systemReduced, {
    setMuted: (muted) => audio.setMuted(muted),
    setMotion: (enabled) => renderHost.environment?.setMotion(enabled),
    setAttribute(name, value) {
      document.body.dataset[name] = value;
    },
  });
};
const renderHost = createRenderHost(
  async () => {
    const { createEnvironment } = await import('./render/environment.ts');
    const environment = createEnvironment(canvas, {
      motion: effectiveMotion(data.preferences, systemReduced),
    });
    document.body.dataset['render'] = 'webgl';
    return environment;
  },
  () => {
    document.body.dataset['render'] = 'fallback';
  },
);
window.addEventListener('pagehide', () => renderHost.dispose());
applySettings();

const tools: Tool[] = [
  {
    id: 'status',
    label: 'STATUS',
    run: (terminal) => terminal.print(['LINK: ONE-WAY', 'OBSERVERS ONLINE: 1'], 'dim'),
  },
  {
    id: 'settings',
    label: 'SETTINGS',
    run(terminal) {
      openSettings(terminal.openPanel(), {
        preferences: data.preferences,
        systemReduced,
        onChange() {
          writeSave(localStorage, data);
          applySettings();
        },
        onReset() {
          resetSave(localStorage);
          window.location.reload();
        },
        onClose: () => terminal.closePanel(),
      });
    },
  },
  {
    id: 'help',
    label: 'HELP',
    run: (terminal) => terminal.print(['TYPE A TOOL NUMBER OR NAME, OR SELECT IT.'], 'dim'),
  },
];

tools.unshift({
  id: 'echo',
  label: 'ECHO',
  run(terminal) {
    const line = game.say(echo, 'hint') ?? game.say(echo, 'idle');
    if (line) terminal.print(line.text);
  },
});

for (const puzzle of content.puzzles) {
  if (puzzle.kind !== 'carrier') continue;
  tools.unshift({
    id: puzzle.id,
    label: 'ANALYZER',
    run(terminal) {
      if (game.isSolved(puzzle.id)) {
        terminal.print(puzzle.success, 'dim');
        return;
      }
      terminal.print(puzzle.briefing);
      openAnalyzer(
        terminal.openPanel(),
        puzzle,
        ({ outcome }) => {
          const result = game.attempt(puzzle.id, { kind: 'carrier', outcome });
          terminal.print(result.feedback, result.status === 'solved' ? 'normal' : 'alert');
          audio.play(result.status === 'solved' ? 'success' : 'error');
          if (result.status === 'solved') {
            terminal.closePanel();
            const reaction = game.say(echo, 'reaction');
            if (reaction) terminal.print(reaction.text);
          }
        },
        () => audio.play('interference'),
      );
    },
  });
}

const scenes = createSceneManager();
scenes.show(
  createOpening(root, screen('opening'), () => {
    audio.unlock();
    audio.play('startup');
    scenes.show(createHub(root, screen('boot'), tools));
  }),
);
