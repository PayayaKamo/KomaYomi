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
      reporter: ['text', 'lcovonly'],
      reportsDirectory: 'tests/.coverage',
      include: ['server/**/*.ts', 'shared/**/*.ts'],
      exclude: [
        // HTTP routing and process entry points run end-to-end via the dev server / CLI,
        // so unit tests would only restate their wiring.
        'server/app.ts',
        'server/standalone.ts',
        'server/plugin.ts',
        // User-provided plugin files are imported dynamically with cache-busting URLs;
        // plugin behavior itself is covered by tests/unit/plugins.test.ts.
        'server/plugins.ts',
        // Talks to remote WebDAV / NAS endpoints that CI cannot provision.
        'server/storageProviders.ts',
      ],
      // Floors sit about two points below today's totals (statements/lines 71.9, branches 73.2,
      // functions 81.2): small refactors may dip, but a module losing its tests still fails.
      thresholds: {
        statements: 70,
        branches: 71,
        functions: 79,
        lines: 70,
      },
    },
  },
});
