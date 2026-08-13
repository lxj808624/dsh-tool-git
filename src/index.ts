/**
 * dsh-tool-git — a structured, safe Git tool family for DeepSeek Harness.
 *
 * Registers eight model-facing tools (`git_status`, `git_diff`, `git_log`,
 * `git_branch`, `git_stage`, `git_commit`, `git_stash`, `git_show`) that run
 * `git` through a shell-free subprocess runner and return canonical JSON
 * values, plus a `tools/pre-execute` safety gate that denies (or asks about)
 * destructive git operations such as force push, hard reset, and history
 * rewrites — whether invoked through these tools or through a shell tool.
 *
 * @module dsh-tool-git
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installSafetyGate, type DestructivePolicy } from './safety.ts'
import { registerGitTools } from './tools/index.ts'

export const name = 'tool-git'
export const inject = ['tools']

/** dsh-tool-git plugin configuration. */
export interface Config {
  /**
   * Directory to start git repository discovery from. Each tool call may
   * override it with its own `repoDir` argument. Defaults to the process
   * working directory.
   */
  workDir: string
  /** The `git` executable to invoke. Defaults to `git` on PATH. */
  gitPath: string
  /**
   * How the safety gate treats destructive git operations: `deny` (default)
   * rejects them with an explanation, `ask` routes them through the approval
   * seam, `allow` disables the gate.
   */
  destructivePolicy: DestructivePolicy
  /** Extra case-insensitive regex strings matched against shell command text. */
  extraDestructivePatterns: string[]
  /** Default commit count for `git_log` when the caller omits `maxCount`. */
  logMaxCommits: number
  /** Default unified-diff context lines for `git_diff` / `git_show` patches. */
  diffContextLines: number
}

/** Schemastery configuration schema for the plugin consumer. */
export const Config: z<Config> = z.object({
  workDir: z.string().default(process.cwd()),
  gitPath: z.string().default('git'),
  destructivePolicy: z.union([
    z.const('deny'),
    z.const('ask'),
    z.const('allow'),
  ]).default('deny'),
  extraDestructivePatterns: z.array(z.string()).default([]),
  logMaxCommits: z.number().default(20),
  diffContextLines: z.number().default(3),
})

/**
 * Apply the plugin: register the git tools and install the destructive
 * command safety gate.
 * @param ctx - registrant context carrying the tool runtime.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  registerGitTools(ctx, config)
  installSafetyGate(ctx, {
    destructivePolicy: config.destructivePolicy,
    extraDestructivePatterns: config.extraDestructivePatterns,
  })
}
