/**
 * `git_stash` — list, push, and pop stashes.
 * @module dsh-tool-git/tools/stash
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseStashList, type ParsedStash } from '../parse.ts'
import { GitError } from '../runner.ts'
import { createGitContext, type ToolOptions } from './context.ts'

/** Canonical `git_stash` value. */
export interface StashValue {
  repoDir: string
  action: 'list' | 'push' | 'pop'
  stashes?: ParsedStash[]
  pushed?: boolean
  applied?: boolean
  message?: string
}

export function defineStashTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_stash',
    description:
      'Manage git stashes. `list` shows saved stashes. `push` stashes the working tree '
      + '(optionally including untracked files) so work can be set aside; `pop` re-applies the '
      + 'most recent stash (or the one named by `stash`) and removes it. A pop that conflicts '
      + 'leaves the stash in place and reports `applied: false`.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      action: { type: 'string', required: true, enum: ['list', 'push', 'pop'], description: 'What to do with stashes.' },
      message: { type: 'string', description: 'Stash message for `push`.' },
      includeUntracked: { type: 'boolean', description: 'For `push`: also stash untracked files (git stash -u).' },
      stash: { type: 'string', description: 'For `pop`: which stash to apply, e.g. stash@{1}. Defaults to the newest.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          action: { type: 'string', required: true, enum: ['list', 'push', 'pop'] },
          stashes: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                message: { type: 'string', required: true },
              },
            },
          },
          pushed: { type: 'boolean', description: 'For `push`: whether anything was stashed.' },
          applied: { type: 'boolean', description: 'For `pop`: whether the stash was applied and dropped.' },
          message: { type: 'string' },
        },
      },
      render: (_args, value: StashValue) => [{
        type: 'text',
        text: value.action === 'list'
          ? value.stashes?.length
            ? value.stashes.map(s => `${s.id} ${s.message}`).join('\n')
            : 'No stashes.'
          : value.action === 'push'
            ? (value.pushed ? 'Stashed working tree changes.' : 'Nothing to stash (working tree clean).')
            : (value.applied ? 'Stash applied and dropped.' : 'Stash pop did not complete (likely a conflict); the stash was kept.'),
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      if (args.action === 'list') {
        const { stdout } = await ctx.run(['stash', 'list', '--format=%gd%x1f%gs%x1e'])
        return {
          repoDir: ctx.repoDir,
          action: 'list' as const,
          stashes: parseStashList(stdout),
        }
      }
      if (args.action === 'push') {
        const cmd = ['stash', 'push']
        if (args.message) cmd.push('-m', args.message)
        if (args.includeUntracked === true) cmd.push('-u')
        const { stdout, stderr } = await ctx.run(cmd)
        const nothing = /no local changes to save/i.test(stdout + stderr)
        const result: StashValue = {
          repoDir: ctx.repoDir,
          action: 'push',
          pushed: !nothing,
        }
        if (args.message) result.message = args.message
        return result
      }
      // action === 'pop'
      const cmd = ['stash', 'pop']
      if (args.stash) cmd.push(args.stash)
      try {
        await ctx.run(cmd)
        return {
          repoDir: ctx.repoDir,
          action: 'pop' as const,
          applied: true,
        }
      } catch (error) {
        if (error instanceof GitError && /conflict/i.test(error.stderr)) {
          return {
            repoDir: ctx.repoDir,
            action: 'pop' as const,
            applied: false,
            message: error.stderr.trim(),
          }
        }
        throw error
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Git stash', kind: 'other', rawInput: args }),
  })
}
