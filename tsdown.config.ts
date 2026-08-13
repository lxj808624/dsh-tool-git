import { defineConfig } from 'tsdown'

/**
 * Author-side build. `tsc -b` emits declarations into `lib/types` first; this
 * pass emits the runtime JavaScript into `lib`. The tsconfig project
 * references resolve types against a sibling `deepseek-harness` checkout
 * (dev machines and CI only) — see tsconfig.prepare.json for the
 * consumer-side build that `pnpm prepare` runs after a git install.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  dts: false,
  clean: false,
  tsconfig: 'tsconfig.prepare.json',
})
