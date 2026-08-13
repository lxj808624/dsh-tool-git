/**
 * `git_checkout` — switch branches, or create and switch to a new one.
 * @module dsh-tool-git/tools/checkout
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createGitContext, type ToolOptions } from './context.ts'

/** Canonical `git_checkout` value. */
export interface CheckoutValue {
  repoDir: string
  branch: string
  created: boolean
}

export function defineCheckoutTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_checkout',
    description:
      'Switch the working tree to another branch, or create a new branch and switch to it '
      + '(`create: true`, like `git checkout -b`). This tool never discards changes: it refuses '
      + 'to pass `--`, `-f`, or a path — destructive checkouts are covered by the safety gate '
      + 'instead. Use `git_status` first if the working tree is dirty.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      branch: { type: 'string', required: true, description: 'Branch to switch to, or (with create) the new branch name.' },
      create: { type: 'boolean', description: 'Create the branch first (git checkout -b) if it does not exist.' },
      start: { type: 'string', description: 'Start point for `create` (a commit, branch, or tag). Defaults to HEAD.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          branch: { type: 'string', required: true },
          created: { type: 'boolean', required: true },
        },
      },
      render: (_args, value: CheckoutValue) => [{
        type: 'text',
        text: value.created
          ? `Created and switched to branch ${value.branch}.`
          : `Switched to branch ${value.branch}.`,
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const branch = args.branch.trim()
      if (branch.length === 0) {
        throw new Error('git_checkout: `branch` must be a non-empty string')
      }
      const cmd = ['checkout']
      let created = false
      if (args.create === true) {
        cmd.push('-b', branch)
        if (args.start) cmd.push(args.start)
        created = true
      } else {
        cmd.push(branch)
      }
      await ctx.run(cmd)
      return { repoDir: ctx.repoDir, branch, created }
    },
    presentCall: args => ({ card: 'generic', title: 'Git checkout', kind: 'other', rawInput: args }),
  })
}
