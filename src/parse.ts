/**
 * Parsers for the machine-readable `git` output formats the tools rely on:
 * `--porcelain=v2` (status), `--numstat` (diff/show stats), `--format` records
 * (log/show), and `for-each-ref` (branch).
 * @module dsh-tool-git/parse
 */

/** A changed file's status letter as git reports it. */
export type GitStatusLetter = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'

/** Human-facing status derived from a git status letter. */
export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechanged' | 'unmerged'

/** Map a porcelain status letter to the canonical status name. */
export function statusName(letter: GitStatusLetter): ChangeStatus {
  switch (letter) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'typechanged'
    case 'U': return 'unmerged'
  }
}

/** One staged or unstaged change from `git status --porcelain=v2`. */
export interface PorcelainEntry {
  path: string
  status: ChangeStatus
  oldPath?: string
}

/** The parsed result of `git status --porcelain=v2 --branch`. */
export interface ParsedStatus {
  branch: string | null
  detached: boolean
  ahead: number
  behind: number
  staged: PorcelainEntry[]
  unstaged: PorcelainEntry[]
  untracked: string[]
}

/**
 * Parse `git status --porcelain=v2 [--branch]` output.
 *
 * Format reference: header lines start with `#`; entry lines start with a
 * status (`1`/`2`/`u` for tracked changes, `?` untracked, `!` ignored) and
 * carry a two-letter XY pair where X is the staged status and Y the unstaged
 * status. Paths may contain spaces, so all fields after the fixed prefix are
 * joined rather than split.
 * @param output - raw porcelain v2 output.
 * @returns the structured status.
 */
export function parseStatusPorcelainV2(output: string): ParsedStatus {
  const parsed: ParsedStatus = {
    branch: null,
    detached: false,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
  }
  for (const line of output.split('\n')) {
    if (line.length === 0) continue
    if (line.startsWith('#')) {
      const header = line.slice(2)
      if (header.startsWith('branch.head ')) {
        const name = header.slice('branch.head '.length)
        parsed.detached = name === '(detached)'
        parsed.branch = parsed.detached ? null : name
      } else if (header.startsWith('branch.ab ')) {
        const match = /^branch\.ab \+(\d+) -(\d+)$/.exec(header)
        if (match) {
          parsed.ahead = Number(match[1]!)
          parsed.behind = Number(match[2]!)
        }
      }
      continue
    }
    const tokens = line.split(' ')
    const kind = tokens[0]
    if (kind === '1') {
      const xy = tokens[1]!
      const path = tokens.slice(8).join(' ')
      addEntry(parsed, xy, path, undefined)
    } else if (kind === '2') {
      const xy = tokens[1]!
      const path = tokens[9]!
      const oldPath = tokens.length > 10 ? tokens.slice(10).join(' ') : undefined
      addEntry(parsed, xy, path, oldPath)
    } else if (kind === 'u') {
      const xy = tokens[1]!
      const path = tokens.slice(10).join(' ')
      parsed.unstaged.push({ path, status: 'unmerged' })
      if (xy[0] !== '.') parsed.staged.push({ path, status: 'unmerged' })
    } else if (kind === '?') {
      parsed.untracked.push(tokens.slice(1).join(' '))
    }
    // '!' (ignored) entries are only emitted with --ignored; intentionally dropped.
  }
  return parsed
}

/** Add a porcelain `1`/`2` entry to the staged/unstaged buckets. */
function addEntry(parsed: ParsedStatus, xy: string, path: string, oldPath: string | undefined): void {
  const staged = xy[0]
  const unstaged = xy[1]
  if (staged !== '.') {
    const entry: PorcelainEntry = { path, status: statusName(staged as GitStatusLetter) }
    if (oldPath !== undefined) entry.oldPath = oldPath
    parsed.staged.push(entry)
  }
  if (unstaged !== '.') {
    const entry: PorcelainEntry = { path, status: statusName(unstaged as GitStatusLetter) }
    if (oldPath !== undefined) entry.oldPath = oldPath
    parsed.unstaged.push(entry)
  }
}

/** Per-file diff statistics from `git diff --numstat`. */
export interface NumstatFile {
  path: string
  insertions: number
  deletions: number
  /** Set when the diff reports a rename (`old => new`). */
  oldPath?: string
}

/**
 * Parse `--numstat` output. Lines are `insertions<TAB>deletions<TAB>path`;
 * binary files report `-` for both counts, and renames render as
 * `old => new`. When a path itself contains a tab the parser is best-effort;
 * `git` quotes such paths in this format and we pass the raw remainder.
 * @param output - raw numstat output.
 * @returns the parsed per-file statistics.
 */
export function parseNumstat(output: string): NumstatFile[] {
  const files: NumstatFile[] = []
  for (const line of output.split('\n')) {
    if (line.length === 0) continue
    const match = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line)
    if (!match) continue
    const insertions = match[1] === '-' ? 0 : Number(match[1])
    const deletions = match[2] === '-' ? 0 : Number(match[2])
    let path = match[3]!
    const rename = /^(.+) => (.+)$/.exec(path)
    let oldPath: string | undefined
    if (rename) {
      oldPath = rename[1]!
      path = rename[2]!
    }
    const file: NumstatFile = { path, insertions, deletions }
    if (oldPath !== undefined) file.oldPath = oldPath
    files.push(file)
  }
  return files
}

/** One commit record from a `--format` log/show run. */
export interface CommitRecord {
  hash: string
  shortHash: string
  authorName: string
  authorEmail: string
  /** Strict ISO-8601 timestamp with timezone offset. */
  date: string
  subject: string
  /** Body text without the subject; empty when absent. */
  body: string
}

/**
 * Parse `--format` records using field separator \x1f and record separator
 * \x1e, produced with:
 * `--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1f%b%x1e`
 * @param output - raw formatted output.
 * @returns the parsed commit records in output order.
 */
export function parseCommitRecords(output: string): CommitRecord[] {
  const records: CommitRecord[] = []
  for (const record of output.split('\x1e')) {
    if (record.length === 0) continue
    const fields = record.split('\x1f')
    if (fields.length < 6) continue
    const [hash, shortHash, authorName, authorEmail, date, subject, ...bodyParts] = fields
    if (!hash || !shortHash || !authorName || !authorEmail || !date || !subject) continue
    records.push({
      hash,
      shortHash,
      authorName,
      authorEmail,
      date,
      subject,
      body: bodyParts.join('\x1f'),
    })
  }
  return records
}

/** One branch from `git for-each-ref` / `git branch --format`. */
export interface ParsedBranch {
  name: string
  current: boolean
  upstream?: string
  ahead?: number
  behind?: number
}

/**
 * Parse `git for-each-ref refs/heads --format=...` output with the atom
 * sequence `%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)`
 * and parse `[ahead N, behind M]` / `[gone]` track annotations.
 * @param output - raw for-each-ref output.
 * @returns the parsed branches.
 */
export function parseBranches(output: string): ParsedBranch[] {
  const branches: ParsedBranch[] = []
  for (const line of output.split('\n')) {
    if (line.length === 0) continue
    const [name, head, upstream, track] = line.split('\0')
    if (!name) continue
    const branch: ParsedBranch = {
      name,
      current: head === '*',
    }
    if (upstream) branch.upstream = upstream
    const ahead = /ahead (\d+)/.exec(track ?? '')
    const behind = /behind (\d+)/.exec(track ?? '')
    if (ahead) branch.ahead = Number(ahead[1]!)
    if (behind) branch.behind = Number(behind[1]!)
    branches.push(branch)
  }
  return branches
}

/** One stash entry from `git stash list --format=%gd%x1f%gs`. */
export interface ParsedStash {
  /** Ref name such as `stash@{0}`. */
  id: string
  /** Stash message (usually "On <branch>: <subject>"). */
  message: string
}

/** Parse `git stash list --format=%gd%x1f%gs%x1e` output. */
export function parseStashList(output: string): ParsedStash[] {
  const stashes: ParsedStash[] = []
  for (const record of output.split('\x1e')) {
    if (record.trim().length === 0) continue
    const [id, ...rest] = record.split('\x1f')
    if (!id) continue
    stashes.push({ id, message: rest.join('\x1f') })
  }
  return stashes
}
