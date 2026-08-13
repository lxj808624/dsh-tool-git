/**
 * `git_pull` — fetch and integrate upstream changes.
 * @module dsh-tool-git/tools/pull
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { GitError } from '../runner.ts'
import { createGitContext, type ToolOptions } from './context.ts'

/** Canonical `git_pull` value. */
export interface PullValue {
  repoDir: string
  pulled: boolean
  /** Why the pull did not complete, e.g. not-fast-forward or conflict. */
  reason?: string
  /** Trimmed pull output / error detail. */
  message: string
}

export function definePullTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_pull',
    description:
      'Fetch and integrate changes from the upstream remote into the current branch. '
      + 'Fast-forward-only by default (`--ff-only`); set `ffOnly: false` to allow a merge commit '
      + 'or use `rebase: true` (destructive: rewrites local commits, guarded by policy) to replay '
      + 'local commits on top. A conflict or non-fast-forward outcome reports `pulled: false` with '
      + 'a reason instead of failing the call.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      remote: { type: 'string', description: 'Remote to pull from (default: the configured upstream).' },
      branch: { type: 'string', description: 'Branch to pull (default: the upstream branch).' },
      ffOnly: { type: 'boolean', description: 'Fast-forward only (default true); false allows a merge commit.' },
      rebase: { type: 'boolean', description: 'Replay local commits on top of the fetched commits instead of merging (destructive: guarded by policy).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          pulled: { type: 'boolean', required: true },
          reason: { type: 'string', description: 'not-fast-forward | conflict | none.' },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value: PullValue) => [{
        type: 'text',
        text: value.pulled
          ? 'Pulled successfully.' + (value.message ? `\n${value.message}` : '')
          : `Pull did not complete (${value.reason ?? 'unknown'}). ${value.message}`,
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const cmd = ['pull']
      if (args.rebase === true) cmd.push('--rebase')
      else if (args.ffOnly !== false) cmd.push('--ff-only')
      if (args.remote) cmd.push(args.remote)
      if (args.branch) cmd.push(args.branch)
      try {
        const { stdout, stderr } = await ctx.run(cmd)
        return {
          repoDir: ctx.repoDir,
          pulled: true,
          message: (stdout + stderr).trim(),
        }
      } catch (error) {
        if (error instanceof GitError) {
          const combined = error.stderr + error.stdout
          const reason = /conflict/i.test(combined)
            ? 'conflict'
            : /not possible to fast-forward|cannot pull with rebase|would be overwritten|have diverged/i.test(combined)
              ? 'not-fast-forward'
              : undefined
          const result: PullValue = {
            repoDir: ctx.repoDir,
            pulled: false,
            message: combined.trim() || error.message,
          }
          if (reason) result.reason = reason
          return result
        }
        throw error
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Git pull', kind: 'other', rawInput: args }),
  })
}
