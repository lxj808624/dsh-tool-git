/**
 * `git_show` — a single commit: metadata, statistics, optional patch.
 * @module dsh-tool-git/tools/show
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseDiffBlocks } from '../diff-blocks.ts'
import { parseCommitRecords, parseNumstat, type CommitRecord } from '../parse.ts'
import { createGitContext, type ToolOptions } from './context.ts'

export interface ShowToolOptions extends ToolOptions {
  /** Default unified-diff context lines when `patch` is requested. */
  diffContextLines: number
}

/** One changed file in the canonical `git_show` value. */
export interface ShowFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied'
  insertions: number
  deletions: number
  patch?: string
}

/** Canonical `git_show` value. */
export interface ShowValue {
  repoDir: string
  hash: string
  shortHash: string
  authorName: string
  authorEmail: string
  date: string
  subject: string
  body: string
  files: ShowFile[]
  totalInsertions: number
  totalDeletions: number
}

const SHOW_FORMAT = '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e'

export function defineShowTool(opts: ShowToolOptions) {
  return defineTool({
    name: 'git_show',
    description:
      'Show one commit: author, date, subject, body, per-file statistics, and optionally the '
      + 'full unified diff patch. Defaults to HEAD; pass any revision, branch name, or tag.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      rev: { type: 'string', description: 'Revision to show (commit hash, branch, tag). Defaults to HEAD.' },
      patch: { type: 'boolean', description: 'Include the unified diff patch text per file.' },
      contextLines: { type: 'integer', description: `Context lines for the patch (default ${opts.diffContextLines}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          hash: { type: 'string', required: true },
          shortHash: { type: 'string', required: true },
          authorName: { type: 'string', required: true },
          authorEmail: { type: 'string', required: true },
          date: { type: 'string', required: true },
          subject: { type: 'string', required: true },
          body: { type: 'string', required: true },
          files: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['added', 'modified', 'deleted', 'renamed', 'copied'] },
                insertions: { type: 'integer', required: true },
                deletions: { type: 'integer', required: true },
                patch: { type: 'string' },
              },
            },
          },
          totalInsertions: { type: 'integer', required: true },
          totalDeletions: { type: 'integer', required: true },
        },
      },
      render: (_args, value: ShowValue) => [{
        type: 'text',
        text: `${value.shortHash} ${value.subject}\n`
          + `Author: ${value.authorName} <${value.authorEmail}>  Date: ${value.date}\n`
          + `${value.files.length} file(s) changed, +${value.totalInsertions}/-${value.totalDeletions}`
          + (value.body ? `\n\n${value.body}` : ''),
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const rev = args.rev?.trim() || 'HEAD'
      const { stdout: showOut } = await ctx.run(['show', SHOW_FORMAT, '--numstat', rev])
      // The format records end with \x1e; the numstat body follows the record separator.
      const separator = showOut.indexOf('\x1e')
      const headerText = separator >= 0 ? showOut.slice(0, separator + 1) : showOut
      const statsText = separator >= 0 ? showOut.slice(separator + 1) : ''
      const [record]: CommitRecord[] = parseCommitRecords(headerText)
      if (!record) {
        throw new Error(`git_show: cannot read commit ${rev}`)
      }
      const files: ShowFile[] = parseNumstat(statsText).map(f => ({
        path: f.path,
        status: f.oldPath ? 'renamed' : 'modified',
        insertions: f.insertions,
        deletions: f.deletions,
      }))
      if (args.patch === true) {
        const { stdout: patchOut } = await ctx.run([
          'show', '--format=', `--unified=${args.contextLines ?? opts.diffContextLines}`, rev,
        ])
        for (const block of parseDiffBlocks(patchOut)) {
          const file = files.find(f => f.path === block.path)
          if (file) file.patch = block.text
        }
      }
      return {
        repoDir: ctx.repoDir,
        hash: record.hash,
        shortHash: record.shortHash,
        authorName: record.authorName,
        authorEmail: record.authorEmail,
        date: record.date,
        subject: record.subject,
        body: record.body,
        files,
        totalInsertions: files.reduce((sum, f) => sum + f.insertions, 0),
        totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Git show', kind: 'read', rawInput: args }),
  })
}
