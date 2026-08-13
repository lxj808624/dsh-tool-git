/**
 * Test fixtures: a disposable git repository and a booted plugin context.
 * @module dsh-tool-git/tests/helpers
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import * as gitPlugin from '../src/index.ts'

/** A disposable repository with one initial commit on `main`. */
export interface TempRepo {
  dir: string
  /** Remove the repository and all its files. */
  cleanup: () => void
  /** Run git in the repository; throws on non-zero exit. */
  git: (args: string[]) => string
  /** Write a file relative to the repository root. */
  write: (relativePath: string, content: string) => void
}

/** Create a temporary git repository with a committed README. */
export function makeTempRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-tool-git-'))
  const git = (args: string[]): string =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
  git(['init', '-b', 'main'])
  git(['config', 'user.name', 'Test User'])
  git(['config', 'user.email', 'test@example.com'])
  git(['config', 'commit.gpgsign', 'false'])
  writeFileSync(join(dir, 'README.md'), '# hello\n')
  git(['add', 'README.md'])
  git(['commit', '-m', 'initial commit'])
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
    git,
    write: (relativePath, content) => writeFileSync(join(dir, relativePath), content),
  }
}

/** Full plugin config the schemastery defaults would produce. */
const DEFAULT_CONFIG: gitPlugin.Config = {
  workDir: process.cwd(),
  gitPath: 'git',
  destructivePolicy: 'deny',
  extraDestructivePatterns: [],
  logMaxCommits: 20,
  diffContextLines: 3,
}

/** Boot a context with SystemPrompt + ToolRuntime + the git plugin. */
export async function setupPlugin(config?: Partial<gitPlugin.Config>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(gitPlugin, { ...DEFAULT_CONFIG, ...config })
  return ctx
}

/** Invoke a registered tool through the full pipeline. */
export async function callTool(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: 'test-call' as never,
    name,
    arguments: args,
  })
}
