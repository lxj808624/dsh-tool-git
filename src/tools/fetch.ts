/**
 * `git_fetch` — download refs from a remote without touching the worktree.
 * @module dsh-tool-git/tools/fetch
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createGitContext, type ToolOptions } from './context.ts'

/** Canonical `git_fetch` value. */
export interface FetchValue {
  repoDir: string
  /** Remote fetched from, or null when the default (all configured) was used. */
  remote: string | null
  /** Trimmed fetch output; empty when nothing was updated. */
  output: string
}

export function defineFetchTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_fetch',
    description:
      'Download commits and refs from a remote without changing the working tree. '
      + 'Safe and non-destructive. Use before `git_pull` to inspect what would arrive, or '
      + 'periodically to stay current with upstream refs.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      remote: { type: 'string', description: 'Remote name (default: the origin remote, or all configured remotes).' },
      prune: { type: 'boolean', description: 'Delete local refs that no longer exist on the remote (git fetch --prune).' },
      tags: { type: 'boolean', description: 'Also fetch tags (git fetch --tags).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          remote: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          output: { type: 'string', required: true },
        },
      },
      render: (_args, value: FetchValue) => [{
        type: 'text',
        text: value.output.length > 0
          ? `Fetched from ${value.remote ?? 'default remote(s)'}:\n${value.output}`
          : `Fetch from ${value.remote ?? 'default remote(s)'} completed with no updates.`,
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const cmd = ['fetch']
      if (args.prune === true) cmd.push('--prune')
      if (args.tags === true) cmd.push('--tags')
      if (args.remote) cmd.push(args.remote)
      const { stdout, stderr } = await ctx.run(cmd)
      const output = (stdout + stderr).trim()
      return {
        repoDir: ctx.repoDir,
        remote: args.remote ?? null,
        output,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Git fetch', kind: 'read', rawInput: args }),
  })
}
