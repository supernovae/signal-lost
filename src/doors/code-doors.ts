import type { CodeDoorRegistration } from './contract.ts';

/** Register reviewed modules here with static metadata and a literal lazy import. */
export const CODE_DOORS: readonly CodeDoorRegistration[] = [
  {
    source: 'src/doors/signal-hunter/signal-hunter.ts',
    metadata: {
      id: 'signal-hunter',
      name: 'SIGNAL HUNTER',
      description: 'Verify local spool traces or practice signal analysis.',
      attribution: { author: 'SIGNAL//LOST maintainers' },
      version: 1,
      requires: 'flag:spool-02-restored',
      rewards: ['flag:manifest-r07-spool-02'],
      returnTo: 'bbs-menu',
    },
    async load(saveSeed) {
      const { createSignalHunterDoor } = await import('./signal-hunter/signal-hunter.ts');
      return { default: createSignalHunterDoor(saveSeed) };
    },
  },
];
