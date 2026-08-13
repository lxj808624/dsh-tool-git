/**
 * `git_branch` — local (or all) branches with upstream tracking state.
 * @module dsh-tool-git/tools/branch
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseBranches, type ParsedBranch } from '../parse.ts'
import { createGitContext, type ToolOptions } from './context.ts'

/** Canonical `git_branch` value. */
export interface BranchValue {
  repoDir: string
  branches: ParsedBranch[]
}

const BRANCH_FORMAT = '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)'

export function defineBranchTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_branch',
    description:
      'List branches with their upstream and ahead/behind tracking state. '
      + 'The current branch is marked with `current: true`.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      all: { type: 'boolean', description: 'Include remote-tracking branches as well as local ones.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          branches: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                current: { type: 'boolean', required: true },
                upstream: { type: 'string' },
                ahead: { type: 'integer' },
                behind: { type: 'integer' },
              },
            },
          },
        },
      },
      render: (_args, value: BranchValue) => [{
        type: 'text',
        text: value.branches.length === 0
          ? 'No branches found.'
          : value.branches.map(b => {
              const marker = b.current ? '* ' : '  '
              const upstream = b.upstream
                ? ` -> ${b.upstream}${b.ahead || b.behind ? ` (ahead ${b.ahead ?? 0}, behind ${b.behind ?? 0})` : ''}`
                : ''
              return `${marker}${b.name}${upstream}`
            }).join('\n'),
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const refs = args.all === true
        ? ['refs/heads', 'refs/remotes']
        : ['refs/heads']
      const { stdout } = await ctx.run(['for-each-ref', BRANCH_FORMAT, ...refs])
      return { repoDir: ctx.repoDir, branches: parseBranches(stdout) }
    },
    presentCall: args => ({ card: 'generic', title: 'Git branches', kind: 'read', rawInput: args }),
  })
}
