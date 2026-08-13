/**
 * `git_diff` — change statistics and optional patch text.
 * @module dsh-tool-git/tools/diff
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { parseDiffBlocks } from '../diff-blocks.ts'
import { parseNumstat } from '../parse.ts'
import { createGitContext, type ToolOptions } from './context.ts'

export interface DiffToolOptions extends ToolOptions {
  /** Default unified-diff context lines when `patch` is requested. */
  diffContextLines: number
}

/** One changed file in the canonical `git_diff` value. */
export interface DiffFile {
  path: string
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'unmerged'
  insertions: number
  deletions: number
  patch?: string
}

/** Canonical `git_diff` value. */
export interface DiffValue {
  repoDir: string
  base: string
  files: DiffFile[]
  totalInsertions: number
  totalDeletions: number
}

export function defineDiffTool(opts: DiffToolOptions) {
  return defineTool({
    name: 'git_diff',
    description:
      'Show changes in the git repository: per-file insertion/deletion statistics and, '
      + 'optionally, the unified diff patch. Diffs the worktree against the index by default; '
      + 'set `cached` to diff the index against HEAD, or pass `rev` to diff the worktree against '
      + 'a revision. Use `path` to limit to one path.',
    parameters: {
      repoDir: { type: 'string', description: 'Explicit git repository directory.' },
      cached: { type: 'boolean', description: 'Diff the index (staged changes) instead of the worktree.' },
      rev: { type: 'string', description: 'Base revision to diff against (e.g. HEAD, HEAD~2, a branch name). Defaults to the index/worktree baseline.' },
      path: { type: 'string', description: 'Limit the diff to a single path.' },
      patch: { type: 'boolean', description: 'Include the unified diff patch text per file.' },
      contextLines: { type: 'integer', description: `Context lines for the patch (default ${opts.diffContextLines}).` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          repoDir: { type: 'string', required: true },
          base: { type: 'string', required: true, description: 'What the diff was taken against: worktree, index, or a revision.' },
          files: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                status: { type: 'string', required: true, enum: ['added', 'modified', 'deleted', 'renamed', 'copied', 'unmerged'] },
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
      render: (_args, value: DiffValue) => [{
        type: 'text',
        text: renderDiff(value),
      }],
    },
    async execute(args, exec) {
      const ctx = await createGitContext(opts, args, exec.signal)
      const base = args.cached ? 'index' : (args.rev ?? 'worktree')
      const statsArgs = ['diff']
      if (args.cached) statsArgs.push('--cached')
      if (args.rev) statsArgs.push(args.rev)
      statsArgs.push('--numstat')
      const pathArgs = args.path ? ['--', args.path] : []
      const { stdout: statsOut } = await ctx.run([...statsArgs, ...pathArgs])
      const files: DiffFile[] = parseNumstat(statsOut).map(f => ({
        path: f.path,
        status: f.oldPath ? 'renamed' : 'modified',
        insertions: f.insertions,
        deletions: f.deletions,
      }))
      if (args.patch === true) {
        const patchArgs = ['diff']
        if (args.cached) patchArgs.push('--cached')
        if (args.rev) patchArgs.push(args.rev)
        patchArgs.push(`--unified=${args.contextLines ?? opts.diffContextLines}`)
        const { stdout: patchOut } = await ctx.run([...patchArgs, ...pathArgs])
        for (const block of parseDiffBlocks(patchOut)) {
          const file = files.find(f => f.path === block.path)
          if (file) file.patch = block.text
        }
      }
      return {
        repoDir: ctx.repoDir,
        base,
        files,
        totalInsertions: files.reduce((sum, f) => sum + f.insertions, 0),
        totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Git diff', kind: 'read', rawInput: args }),
  })
}

function renderDiff(value: DiffValue): string {
  if (value.files.length === 0) return `No changes against ${value.base}.`
  return `Diff against ${value.base}: ${value.files.length} file(s), `
    + `+${value.totalInsertions}/-${value.totalDeletions}. `
    + value.files.map(f => `${f.path} (${f.status}, +${f.insertions}/-${f.deletions})`).join(', ')
    + '.'
}
