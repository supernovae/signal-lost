import { createEnding } from './app/ending.ts';
import { createHub, type Tool } from './app/hub.ts';
import { createOpening } from './app/opening.ts';
import { applyPreferences, effectiveMotion, openSettings } from './app/settings.ts';
import { createSceneManager } from './app/scenes.ts';
import { buildTools } from './app/tools.ts';
import { bbsCopy, fill } from './bbs/copy.ts';
import { getBbsOffer } from './bbs/offer.ts';
import { bbsThemeStyles } from './bbs/themes.ts';
import { loadBundledContent } from './content/browser.ts';
import type { Episode } from './content/schema.ts';
import { createAudio } from './audio/audio.ts';
import { createDialogueSources } from './narrative/dialogue.ts';
import { deriveAccessLevel } from './progress/access.ts';
import { openSaveSession } from './progress/save.ts';
import { createGame } from './puzzle/game.ts';
import { createRenderHost } from './render/host.ts';
import type { Terminal } from './terminal/terminal.ts';
import './style.css';

const root = document.querySelector<HTMLElement>('#app')!;
const canvas = document.querySelector<HTMLCanvasElement>('#viewscreen')!;
const { content } = loadBundledContent();
const screen = (id: string): readonly string[] =>
  content.screens.find((s) => s.id === id)?.lines ?? [];

const session = openSaveSession({
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
  removeItem: (key) => localStorage.removeItem(key),
});
const { data } = session;
const game = createGame({ content, data, persist: session.persist });
const voices = createDialogueSources(content.characters);
const echo = voices.get('echo')!;
const sayOnBbs = (characterId: string) => {
  const source = voices.get(characterId);
  return source && game.say(source, 'bbs');
};

const audio = createAudio();
const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const applySettings = (): void => {
  applyPreferences(data.preferences, systemReduced, {
    setMuted: (muted) => audio.setMuted(muted),
    setMotion: (enabled) => renderHost.environment?.setMotion(enabled),
    setBbsTheme(theme) {
      document.body.dataset['bbsTheme'] = theme;
      for (const [name, value] of Object.entries(bbsThemeStyles(theme))) {
        document.body.style.setProperty(name, value);
      }
    },
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

function showSettings(terminal: Terminal): void {
  const close = () => {
    terminal.closePanel();
    terminal.focus();
  };
  openSettings(terminal.openPanel(), {
    preferences: data.preferences,
    systemReduced,
    onChange() {
      session.persist();
      applySettings();
    },
    onReset() {
      if (session.clear()) window.location.reload();
      else close();
    },
    onClose: close,
  });
}

const utilities: Tool[] = [
  {
    id: 'status',
    label: 'STATUS',
    run(terminal) {
      const { designation, handle } = data.profile;
      const level = deriveAccessLevel(content.accessLevels, game.facts());
      const lines = ['LINK: ONE-WAY', 'OBSERVERS ONLINE: 1'];
      if (designation) lines.push(`DESIGNATION: ${designation}`);
      if (handle) lines.push(`HANDLE: ${handle}`);
      if (level) lines.push(fill(bbsCopy.text.accessLevel, { level: level.label }));
      terminal.print(lines, 'dim');
    },
  },
  {
    id: 'settings',
    label: 'SETTINGS',
    run: showSettings,
  },
  {
    id: 'help',
    label: 'HELP',
    run: (terminal) => terminal.print(['TYPE A TOOL NUMBER OR NAME, OR SELECT IT.'], 'dim'),
  },
];

const scenes = createSceneManager();
const motionAllowed = (): boolean => effectiveMotion(data.preferences, systemReduced);
let resetNoticePending = session.status === 'reset';
const showHub = (): void => {
  const lines = [...screen('boot')];
  if (resetNoticePending) lines.push(...screen('save-reset'));
  const offer = getBbsOffer(content, game.facts());
  if (offer) lines.push(offer.board.notice);
  resetNoticePending = false;
  let active = true;
  let connecting = false;
  const hub = createHub(root, lines, () => {
    const tools = buildTools(toolContext);
    if (!offer) return tools;
    return [
      ...tools,
      {
        id: 'connect',
        label: 'CONNECT',
        run(terminal) {
          if (connecting) return;
          connecting = true;
          terminal.print([`CONNECTING TO ${offer.board.title}.`], 'dim');
          void import('./bbs/connection.ts').then(
            ({ createBbsConnection }) => {
              if (!active) return;
              scenes.show(
                createBbsConnection({
                  root,
                  offer,
                  content,
                  session,
                  say: sayOnBbs,
                  onSettings: showSettings,
                  onDisconnect: showHub,
                }),
              );
            },
            () => {
              if (!active) return;
              connecting = false;
              terminal.print(['CONNECTION UNAVAILABLE.'], 'alert');
              terminal.focus();
            },
          );
        },
      },
    ];
  });
  scenes.show({
    mount: hub.mount,
    dispose() {
      active = false;
      hub.dispose();
    },
  });
};
const toolContext = {
  content,
  game,
  audio,
  echo,
  utilities,
  onEpisodeComplete(episode: Episode) {
    const footer = [`OBSERVER DESIGNATION ASSIGNED: ${data.profile.designation ?? ''}`];
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
