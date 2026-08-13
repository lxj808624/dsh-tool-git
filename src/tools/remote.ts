/**
 * `git_remote` — list configured remotes.
 * @module dsh-tool-git/tools/remote
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { createGitContext, type ToolOptions } from './context.ts'

/** Canonical `git_remote` value. */
export interface RemoteValue {
  repoDir: string
  remotes: Array<{
    name: string
    url: string
    pushUrl?: string
  }>
}

/**
 * Parse `git remote -v` output: `name<TAB>url (fetch)` and
 * `name<TAB>url (push)` lines, folded per remote name. `pushUrl` is only
 * reported when it differs from the fetch `url`.
 */
export function parseRemoteV(output: string): RemoteValue['remotes'] {
  const byName = new Map<string, RemoteValue['remotes'][number]>()
  for (const line of output.split('\n')) {
    const match = /^(\S+)\t(\S+) \((fetch|push)\)$/.exec(line)
    if (!match) continue
    const name = match[1]!
    const url = match[2]!
    const kind = match[3]!
    const entry = byName.get(name)
    if (kind === 'push') {
      if (entry) {
        if (url !== entry.url) entry.pushUrl = url
      } else {
        byName.set(name, { name, url, pushUrl: url })
      }
    } else if (!entry) {
      byName.set(name, { name, url })
    }
  }
  return [...byName.values()]
}

export function defineRemoteTool(opts: ToolOptions) {
  return defineTool({
    name: 'git_remote',
    description:
      'List the configured git remotes with their fetch and push URLs. '
      + 'Useful before fetch/pull to know what upstreams exist.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          remotes: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                url: { type: 'string', required: true },
                pushUrl: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value: RemoteValue) => [{
        type: 'text',
        text: value.remotes.length === 0
          ? 'No remotes configured.'
          : value.remotes.map(r => `${r.name}\t${r.url}${r.pushUrl && r.pushUrl !== r.url ? ` (push: ${r.pushUrl})` : ''}`).join('\n'),
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const { stdout } = await ctx.run(['remote', '-v'])
      return { repoDir: ctx.repoDir, remotes: parseRemoteV(stdout) }
    },
    presentCall: args => ({ card: 'generic', title: 'Git remotes', kind: 'read', rawInput: args }),
  })
}
