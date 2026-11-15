import { defineConfig } from 'vitest/config';

/**
 * Node-side unit tests for `server/` and `shared/`.
 *
 * The app's `vite.config.ts` starts the manga dev server as a plugin, which must not
 * happen while tests import server modules directly, so tests get a dedicated config.
 * Browser-side React components are covered by manual/browser checks for now.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['node_modules/**', 'dist/**', 'dist-server/**', 'docs/**'],
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'tests/.coverage',
      include: ['server/**/*.ts', 'shared/**/*.ts'],
      exclude: ['server/app.ts', 'server/standalone.ts', 'server/plugin.ts', 'server/plugins.ts'],
    },
  },
});
