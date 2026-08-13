import { defineConfig } from 'vitest/config'

// All @deepseek-ai/* imports resolve from node_modules (the published
// 0.0.1-rc.5 public API line) — no tsconfig paths indirection needed.
export default defineConfig({
  resolve: {
    extensions: ['.ts', '.js', '.mjs', '.json'],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
