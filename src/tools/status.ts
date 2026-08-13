/**
 * `git_status` — working tree state as structured data.
 * @module dsh-tool-git/tools/status
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseStatusPorcelainV2, type ChangeStatus, type PorcelainEntry } from '../parse.ts'
import { createGitContext, type ToolOptions } from './context.ts'

const STATUS_NAMES: ChangeStatus[] = [
  'added', 'modified', 'deleted', 'renamed', 'copied', 'typechanged', 'unmerged',
]

/** Canonical `git_status` value. */
export interface StatusValue {
  repoDir: string
  branch: string | null
  detached: boolean
  ahead: number
  behind: number
  isClean: boolean
  staged: PorcelainEntry[]
  unstaged: PorcelainEntry[]
  untracked: string[]
}

export function defineStatusTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_status',
    description:
      'Inspect the git working tree: current branch, ahead/behind counts, staged changes, '
      + 'unstaged changes, and untracked files. Prefer this over running `git status` in bash — '
      + 'it returns structured data the model can reason about directly.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory. Defaults to the configured work directory.' },
      includeIgnored: { type: 'boolean', description: 'Also report ignored files (git status --ignored).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          branch: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true, description: 'Current branch, or null when detached.' },
          detached: { type: 'boolean', required: true },
          ahead: { type: 'integer', required: true },
          behind: { type: 'integer', required: true },
          isClean: { type: 'boolean', required: true },
          staged: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: [...STATUS_NAMES] },
                oldPath: { type: 'string' },
              },
            },
          },
          unstaged: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: [...STATUS_NAMES] },
                oldPath: { type: 'string' },
              },
            },
          },
          untracked: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value: StatusValue) => [{
        type: 'text',
        text: renderStatus(value),
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const cmd = ['status', '--porcelain=v2', '--branch']
      if (args.includeIgnored === true) cmd.push('--ignored')
      const { stdout } = await ctx.run(cmd)
      const parsed = parseStatusPorcelainV2(stdout)
      const stagedCount = parsed.staged.length
      const unstagedCount = parsed.unstaged.length
      const untrackedCount = parsed.untracked.length
      return {
        repoDir: ctx.repoDir,
        branch: parsed.branch,
        detached: parsed.detached,
        ahead: parsed.ahead,
        behind: parsed.behind,
        isClean: stagedCount === 0 && unstagedCount === 0 && untrackedCount === 0,
        staged: parsed.staged,
        unstaged: parsed.unstaged,
        untracked: parsed.untracked,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Git status', kind: 'read', rawInput: args }),
  })
}

function renderStatus(value: StatusValue): string {
  if (value.isClean) {
    return `Working tree clean on ${value.branch ?? 'detached HEAD'}.`
  }
  const parts: string[] = []
  if (value.staged.length > 0) {
    parts.push(`staged: ${value.staged.map(f => `${f.path} (${f.status})`).join(', ')}`)
  }
  if (value.unstaged.length > 0) {
    parts.push(`unstaged: ${value.unstaged.map(f => `${f.path} (${f.status})`).join(', ')}`)
  }
  if (value.untracked.length > 0) {
    parts.push(`untracked: ${value.untracked.join(', ')}`)
  }
  return `Branch ${value.branch ?? '(detached)'}, ahead ${value.ahead}, behind ${value.behind}. ${parts.join('; ')}.`
}
