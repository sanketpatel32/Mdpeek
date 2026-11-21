import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
