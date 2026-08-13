/**
 * `git_log` — commit history as structured records.
 * @module dsh-tool-git/tools/log
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseCommitRecords, type CommitRecord } from '../parse.ts'
import { createGitContext, type ToolOptions } from './context.ts'

export interface LogToolOptions extends ToolOptions {
  /** Default commit count when `maxCount` is not supplied. */
  logMaxCommits: number
}

/** Canonical `git_log` value. */
export interface LogValue {
  repoDir: string
  truncated: boolean
  commits: CommitRecord[]
}

const LOG_FORMAT = '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e'

export function defineLogTool(opts: LogToolOptions) {
  return defineTool({
    name: 'git_log',
    description:
      'List commit history: hash, author, date, and subject for each commit. '
      + 'Use `rev` for a revision range (e.g. "HEAD~5..HEAD" or a branch name) and `path` to '
      + 'narrow history to one path. Results are newest-first.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      maxCount: { type: 'integer', description: `Maximum commits to return (default ${opts.logMaxCommits}, cap 100).` },
      rev: { type: 'string', description: 'Revision or range to log, e.g. HEAD, main, HEAD~5..HEAD.' },
      path: { type: 'string', description: 'Limit history to commits touching this path.' },
      all: { type: 'boolean', description: 'Include commits from all refs (git log --all).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true, description: 'True when the cap was hit and more commits exist.' },
          commits: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                hash: { type: 'string', required: true },
                shortHash: { type: 'string', required: true },
                authorName: { type: 'string', required: true },
                authorEmail: { type: 'string', required: true },
                date: { type: 'string', required: true, description: 'ISO-8601 timestamp with timezone.' },
                subject: { type: 'string', required: true },
                body: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value: LogValue) => [{
        type: 'text',
        text: value.commits.length === 0
          ? 'No commits found.'
          : value.commits.map(c => `${c.shortHash} ${c.date.slice(0, 10)} ${c.subject}`).join('\n')
            + (value.truncated ? '\n… (truncated)' : ''),
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const maxCount = Math.min(Math.max(args.maxCount ?? opts.logMaxCommits, 1), 100)
      const cmd = ['log', LOG_FORMAT, `--max-count=${maxCount}`]
      if (args.all === true) cmd.push('--all')
      if (args.rev) cmd.push(args.rev)
      if (args.path) cmd.push('--', args.path)
      const { stdout } = await ctx.run(cmd)
      const commits = parseCommitRecords(stdout)
      return {
        repoDir: ctx.repoDir,
        truncated: commits.length >= maxCount,
        commits,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Git log', kind: 'read', rawInput: args }),
  })
}
