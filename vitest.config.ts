import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.d.ts', 'src/renderer/**'],
    },
  },
  resolve: {
    alias: {
      electron: path.resolve(__dirname, 'src/main/__mocks__/electron.ts'),
    },
  },
});
