import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { configDefaults, defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@main': path.resolve(rootDir, 'src/main'),
      '@preload': path.resolve(rootDir, 'src/preload'),
      '@renderer': path.resolve(rootDir, 'src/renderer/src'),
      '@shared': path.resolve(rootDir, 'src/shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['vitest.setup.ts'],
    exclude: [...configDefaults.exclude, '.claude/worktrees/**'],
    coverage: {
      reporter: ['text', 'html'],
    },
  },
});
