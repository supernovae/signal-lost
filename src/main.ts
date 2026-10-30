import { createEnding } from './app/ending.ts';
import { createHub, type Tool } from './app/hub.ts';
import { createOpening } from './app/opening.ts';
import { applyPreferences, effectiveMotion, openSettings } from './app/settings.ts';
import { createSceneManager } from './app/scenes.ts';
import { buildTools } from './app/tools.ts';
import { loadBundledContent } from './content/browser.ts';
import type { Episode } from './content/schema.ts';
import { createAudio } from './audio/audio.ts';
import { createScriptedDialogue } from './narrative/dialogue.ts';
import { loadSave, resetSave, writeSave } from './progress/save.ts';
import { createGame } from './puzzle/game.ts';
import { createRenderHost } from './render/host.ts';
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

const utilities: Tool[] = [
  {
    id: 'status',
    label: 'STATUS',
    run(terminal) {
      const designation = data.designation ? [`DESIGNATION: ${data.designation}`] : [];
      terminal.print(['LINK: ONE-WAY', 'OBSERVERS ONLINE: 1', ...designation], 'dim');
    },
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

const scenes = createSceneManager();
const motionAllowed = (): boolean => effectiveMotion(data.preferences, systemReduced);
const showHub = (): void => {
  scenes.show(createHub(root, screen('boot'), () => buildTools(toolContext)));
};
const toolContext = {
  content,
  game,
  audio,
  echo,
  utilities,
  onEpisodeComplete(episode: Episode) {
    const footer = [`OBSERVER DESIGNATION ASSIGNED: ${data.designation ?? ''}`];
    scenes.show(createEnding(root, episode.ending, footer, motionAllowed(), showHub));
  },
};

scenes.show(
  createOpening(root, screen('opening'), () => {
    audio.unlock();
    audio.play('startup');
    showHub();
  }),
);
