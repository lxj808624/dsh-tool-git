/**
 * `git_stage` — stage paths (or everything) into the index.
 * @module dsh-tool-git/tools/stage
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createGitContext, type ToolOptions } from './context.ts'

/** Canonical `git_stage` value. */
export interface StageValue {
  repoDir: string
  mode: 'paths' | 'all' | 'update'
  paths: string[]
}

export function defineStageTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_stage',
    description:
      'Stage files into the git index so they are included in the next commit. '
      + 'Pass explicit `paths` (repo-root-relative), or set `all: true` to stage every change '
      + '(including deletions and untracked files) or `update: true` to stage only already-tracked '
      + 'modifications/deletions. This is a safe, reversible operation.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      paths: {
        type: 'array',
        description: 'Repo-root-relative paths to stage. Required unless `all` or `update` is set.',
        items: { type: 'string' },
      },
      all: { type: 'boolean', description: 'Stage all changes: git add -A.' },
      update: { type: 'boolean', description: 'Stage only tracked modifications and deletions: git add -u.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          mode: { type: 'string', required: true, enum: ['paths', 'all', 'update'] },
          paths: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value: StageValue) => [{
        type: 'text',
        text: value.mode === 'paths'
          ? `Staged: ${value.paths.join(', ')}`
          : value.mode === 'all'
            ? 'Staged all changes.'
            : 'Staged tracked modifications and deletions.',
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      if (args.all === true) {
        await ctx.run(['add', '-A'])
        return { repoDir: ctx.repoDir, mode: 'all' as const, paths: [] }
      }
      if (args.update === true) {
        await ctx.run(['add', '-u'])
        return { repoDir: ctx.repoDir, mode: 'update' as const, paths: [] }
      }
      const paths = (args.paths ?? []).filter(p => typeof p === 'string' && p.length > 0)
      if (paths.length === 0) {
        throw new Error('git_stage: provide `paths`, or set `all` or `update`')
      }
      await ctx.run(['add', '--', ...paths])
      return { repoDir: ctx.repoDir, mode: 'paths' as const, paths }
    },
    presentCall: args => ({ card: 'generic', title: 'Git stage', kind: 'other', rawInput: args }),
  })
}
