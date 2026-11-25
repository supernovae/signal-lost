import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { doorMetadataSchema } from '../src/content/schema.ts';

const args = process.argv.slice(2);
const id = doorMetadataSchema.shape.id.safeParse(args[0]);
if (args.length !== 1 || !id.success) {
  console.error('Usage: npm run door:check -- <door-id> (use lowercase letters, digits, . and -)');
  process.exitCode = 1;
} else {
  const root = resolve(import.meta.dirname, '..');
  const include = ['scripts/door-check.smoke.ts'];
  const suite = `tests/unit/doors/${id.data}.test.ts`;
  if (existsSync(resolve(root, suite))) include.push(suite);

  const { startVitest } = await import('vitest/node');
  await startVitest(
    [],
    { root, config: false, watch: false, api: false },
    {
      server: { watch: null, ws: false },
      test: {
        include,
        environment: 'node',
        reporters: ['default'],
        env: {
          SIGNAL_LOST_DOOR_ID: id.data,
          SIGNAL_LOST_DOOR_CONTENT: resolve('content'),
        },
      },
    },
  );
}
