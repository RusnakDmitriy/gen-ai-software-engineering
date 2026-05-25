import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    fileParallelism: false,
    globalSetup: ['./tests/global-setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      include: ['src/**/*.ts'],
      exclude: [
        'node_modules/**',
        'dist/**',
        'tests/**',
        '**/*.config.ts',
        '**/global-setup.ts',
        'src/server.ts',
        'src/config/env.ts',
        'src/config/logger.ts',
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
