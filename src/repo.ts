/**
 * Working-directory and repository-root resolution shared by every tool.
 * @module dsh-tool-git/repo
 */

import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * Resolve the repository root for a run.
 *
 * An explicit `repoDir` wins and must itself be (or contain) a repository.
 * Otherwise, walk upward from `startDir` (the configured work directory or the
 * process cwd) until a `.git` entry is found — a directory for a normal
 * checkout, a file for a worktree or submodule.
 * @param startDir - directory to start the upward walk from.
 * @param explicit - optional explicit repository directory.
 * @returns the absolute repository root.
 * @throws when no repository is found.
 */
export async function resolveRepoDir(startDir: string, explicit?: string): Promise<string> {
  if (explicit) {
    const dir = resolve(explicit)
    if (await hasGitDir(dir)) return dir
    throw new Error(`no git repository found at or above: ${dir}`)
  }
  let current = resolve(startDir)
  for (;;) {
    if (await hasGitDir(current)) return current
    const parent = dirname(current)
    if (parent === current) {
      throw new Error(`not inside a git repository (walked up from ${current})`)
    }
    current = parent
  }
}

/** True when `dir/.git` exists (directory for checkouts, file for worktrees). */
async function hasGitDir(dir: string): Promise<boolean> {
  try {
    await access(join(dir, '.git'))
    return true
  } catch {
    return false
  }
}
