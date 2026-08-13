/**
 * `git_commit` — create a commit from the staged index.
 * @module dsh-tool-git/tools/commit
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseCommitRecords, parseNumstat } from '../parse.ts'
import { GitError } from '../runner.ts'
import { createGitContext, type ToolOptions } from './context.ts'

/** Canonical `git_commit` value. */
export interface CommitValue {
  repoDir: string
  committed: boolean
  amend: boolean
  hash?: string
  shortHash?: string
  subject?: string
  filesChanged?: number
  insertions?: number
  deletions?: number
  reason?: string
}

const SHOW_FORMAT = '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e'

export function defineCommitTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_commit',
    description:
      'Create a commit from the staged index with the given message. '
      + 'Returns the new commit hash and its statistics. Use `git_stage` first unless everything '
      + 'is already staged. `amend` rewrites the most recent commit and is guarded by the '
      + 'destructive-operation policy. Commit messages should be imperative and concise.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      message: { type: 'string', required: true, description: 'Commit message (subject line).' },
      amend: { type: 'boolean', description: 'Amend the most recent commit instead of creating a new one (destructive: guarded by policy).' },
      allowEmpty: { type: 'boolean', description: 'Allow an empty commit (git commit --allow-empty).' },
      noVerify: { type: 'boolean', description: 'Skip pre-commit and commit-msg hooks (git commit --no-verify).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          committed: { type: 'boolean', required: true },
          amend: { type: 'boolean', required: true },
          hash: { type: 'string' },
          shortHash: { type: 'string' },
          subject: { type: 'string' },
          filesChanged: { type: 'integer' },
          insertions: { type: 'integer' },
          deletions: { type: 'integer' },
          reason: { type: 'string', description: 'Why the commit did not happen, e.g. nothing-to-commit.' },
        },
      },
      render: (_args, value: CommitValue) => [{
        type: 'text',
        text: value.committed
          ? `Committed ${value.shortHash}: ${value.subject} (${value.filesChanged} file(s), +${value.insertions}/-${value.deletions})`
          : `Commit skipped: ${value.reason ?? 'unknown'}`,
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const message = args.message.trim()
      if (message.length === 0) {
        throw new Error('git_commit: `message` must be a non-empty string')
      }
      const cmd = ['commit', '-m', message]
      if (args.amend === true) cmd.push('--amend')
      if (args.allowEmpty === true) cmd.push('--allow-empty')
      if (args.noVerify === true) cmd.push('--no-verify')
      try {
        await ctx.run(cmd)
      } catch (error) {
        if (error instanceof GitError && error.code === 1
          && /nothing to commit|no changes added/i.test(error.stderr + error.stdout)) {
          return {
            repoDir: ctx.repoDir,
            committed: false,
            amend: args.amend === true,
            reason: 'nothing-to-commit',
          }
        }
        throw error
      }
      const { stdout: revOut } = await ctx.run(['rev-parse', 'HEAD'])
      const hash = revOut.trim()
      const { stdout: showOut } = await ctx.run(['show', SHOW_FORMAT, '--numstat', 'HEAD'])
      const [record] = parseCommitRecords(showOut.split('\n\n')[0] ?? '')
      const stats = parseNumstat(showOut)
      return {
        repoDir: ctx.repoDir,
        committed: true,
        amend: args.amend === true,
        hash,
        shortHash: hash.slice(0, 7),
        subject: record?.subject ?? '',
        filesChanged: stats.length,
        insertions: stats.reduce((sum, f) => sum + f.insertions, 0),
        deletions: stats.reduce((sum, f) => sum + f.deletions, 0),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Git commit', kind: 'other', rawInput: args }),
  })
}
