import type { SaveData } from '../progress/save.ts';

export type Preferences = SaveData['preferences'];

export interface SettingsTargets {
  setMuted(muted: boolean): void;
  setMotion(enabled: boolean): void;
  setAttribute(name: 'motion' | 'effects', value: 'on' | 'off'): void;
}

/** An explicit choice wins; otherwise follow the browser's preference. */
export function effectiveMotion(preferences: Preferences, systemReduced: boolean): boolean {
  return !(preferences.reducedMotion ?? systemReduced);
}

export function applyPreferences(
  preferences: Preferences,
  systemReduced: boolean,
  targets: SettingsTargets,
): void {
  const motion = effectiveMotion(preferences, systemReduced);
  targets.setMuted(preferences.muted);
  targets.setMotion(motion);
  targets.setAttribute('motion', motion ? 'on' : 'off');
  targets.setAttribute('effects', preferences.effects ? 'on' : 'off');
}

export interface SettingsPanelOptions {
  preferences: Preferences;
  systemReduced: boolean;
  onChange(): void;
  onReset(): void;
  onClose(): void;
}

function checkbox(
  label: string,
  checked: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const wrapper = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  wrapper.append(input, ` ${label}`);
  return wrapper;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

export function openSettings(panel: HTMLElement, options: SettingsPanelOptions): void {
  const { preferences, systemReduced, onChange, onReset, onClose } = options;
  const form = document.createElement('div');
  form.className = 'settings';

  const reset = document.createElement('div');
  reset.className = 'settings-row';
  const showReset = (): void => {
    const start = button('RESET PROGRESS', () => {
      const confirm = button('CONFIRM RESET', onReset);
      reset.replaceChildren(
        button('KEEP PROGRESS', () => {
          showReset();
          reset.querySelector('button')?.focus();
        }),
        confirm,
      );
      reset.querySelector('button')?.focus();
    });
    reset.replaceChildren(start);
  };
  showReset();

  form.append(
    checkbox('SOUND MUTED', preferences.muted, (value) => {
      preferences.muted = value;
      onChange();
    }),
    checkbox('REDUCE MOTION', !effectiveMotion(preferences, systemReduced), (value) => {
      preferences.reducedMotion = value;
      onChange();
    }),
    checkbox('SCREEN EFFECTS', preferences.effects, (value) => {
      preferences.effects = value;
      onChange();
    }),
    reset,
    button('CLOSE', onClose),
  );
  panel.replaceChildren(form);
}
