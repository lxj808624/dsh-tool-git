/**
 * Shared per-call context for the git tools: resolves the repository root,
 * then runs `git` against it with the call's cancellation signal.
 * @module dsh-tool-git/tools/context
 */

import { resolveRepoDir } from '../repo.ts'
import { runGitChecked } from '../runner.ts'

/** Deployment options every tool inherits from plugin configuration. */
export interface ToolOptions {
  /** `git` executable to invoke. */
  gitPath: string
  /** Directory to start repository discovery from (per-call repoDir wins). */
  workDir: string
}

/** Per-call options shared by every tool's parameters. */
export interface PerCallOptions {
  /** Explicit repository directory; overrides workDir discovery. */
  repoDir?: string
}

/**
 * Resolve the repository root for one call and bind `git` to it.
 * @param opts - deployment options.
 * @param call - per-call options.
 * @param signal - the call's cancellation signal.
 * @returns a context that runs checked git commands in the repo root.
 */
export async function createGitContext(
  opts: ToolOptions,
  call: PerCallOptions,
  signal: AbortSignal,
): Promise<{
  repoDir: string
  /** Run `git` in the repo root and require a zero exit code. */
  run: (args: string[]) => Promise<{ stdout: string; stderr: string }>
}> {
  const repoDir = await resolveRepoDir(opts.workDir, call.repoDir)
  return {
    repoDir,
    async run(args: string[]) {
      const result = await runGitChecked(opts.gitPath, args, { cwd: repoDir, signal })
      return { stdout: result.stdout, stderr: result.stderr }
    },
  }
}
