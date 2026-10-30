import { defineConfig } from 'vitest/config';
import { contentPlugin } from './scripts/content-plugin.ts';
import { SITE_BASE } from './site.config.ts';

export default defineConfig({
  base: SITE_BASE,
  plugins: [contentPlugin()],
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
