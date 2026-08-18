import path from 'path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    // .worktrees holds checkouts of other branches; collecting their specs runs
    // each suite several times against unrelated source trees.
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**', '.worktrees/**'],
  },
});
