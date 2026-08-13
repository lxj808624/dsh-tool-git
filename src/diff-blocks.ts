/**
 * Split a unified diff body (`git diff` / `git show` output) into per-file
 * blocks and derive each file's change status from its header.
 * @module dsh-tool-git/diff-blocks
 */

/** One per-file block of a unified diff. */
export interface DiffBlock {
  /** New-side path (the `b/` side of `diff --git a/x b/y`). */
  path: string
  /** The raw block text including the `diff --git` header. */
  text: string
  /** Change status derived from the block header. */
  status: 'added' | 'deleted' | 'renamed' | 'copied' | 'modified'
}

/**
 * Split unified diff output on `diff --git` headers and parse each block's
 * path and status. Blocks whose path cannot be parsed are skipped; the caller
 * matches remaining blocks to numstat files by path.
 * @param output - raw unified diff output.
 * @returns the parsed blocks in output order.
 */
export function parseDiffBlocks(output: string): DiffBlock[] {
  const blocks: DiffBlock[] = []
  let current: { header: string; lines: string[] } | undefined
  const flush = (): void => {
    if (!current) return
    const path = parseBlockPath(current.header, current.lines)
    if (path) {
      blocks.push({
        path,
        text: current.lines.join('\n'),
        status: parseBlockStatus(current.lines),
      })
    }
    current = undefined
  }
  for (const line of output.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush()
      current = { header: line, lines: [line] }
    } else if (current) {
      current.lines.push(line)
    }
  }
  flush()
  return blocks
}

/** Extract the new-side path from a `diff --git a/x b/y` header. */
function parseBlockPath(header: string, lines: string[]): string | undefined {
  const match = /^diff --git a\/(.*) b\/(.*)$/.exec(header)
  if (match) return match[2]
  // Rename-only diffs may still carry a b/ path; fall back to rename to.
  const renameTo = lines.find(line => line.startsWith('rename to '))
  if (renameTo) return renameTo.slice('rename to '.length)
  return undefined
}

/** Derive a block's change status from its header lines. */
function parseBlockStatus(lines: string[]): DiffBlock['status'] {
  const joined = lines.join('\n')
  if (joined.includes('\nnew file mode ')) return 'added'
  if (joined.includes('\ndeleted file mode ')) return 'deleted'
  if (joined.includes('\nrename from ')) return 'renamed'
  if (joined.includes('\ncopy from ')) return 'copied'
  return 'modified'
}
