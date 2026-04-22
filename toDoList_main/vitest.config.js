import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,       // lets you use describe/it/expect without importing
    include: ['tests/**/*.test.js'],
  },
});