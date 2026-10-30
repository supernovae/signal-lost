import { defineConfig } from 'vitest/config';

// GitHub Pages serves this project from /signal-lost/, so every environment
// uses that base. Subpath bugs then show up in dev and tests, not in production.
export default defineConfig({
  base: process.env['SIGNAL_LOST_BASE'] ?? '/signal-lost/',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/unit/**/*.test.ts'], environment: 'node' },
});
