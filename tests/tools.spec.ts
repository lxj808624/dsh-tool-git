import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { callTool, makeTempRepo, setupPlugin, type TempRepo } from './helpers.ts'

type Result = Awaited<ReturnType<typeof callTool>>

const value = (result: Result): Record<string, unknown> => result.value as Record<string, unknown>

describe('dsh-tool-git tools', () => {
  let repo: TempRepo
  let ctx: Context
  const cleanup: Array<() => void> = []

  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn()
    repo?.cleanup()
  })

  async function boot(): Promise<Context> {
    ctx = await setupPlugin({ workDir: repo.dir })
    return ctx
  }

  describe('git_status', () => {
    it('reports a clean tree with the current branch', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const c = await boot()
      const result = await callTool(c, 'git_status', {})
      expect(result.isError).toBe(false)
      expect(value(result)).toMatchObject({
        isClean: true,
        branch: 'main',
        ahead: 0,
        behind: 0,
        staged: [],
        unstaged: [],
        untracked: [],
      })
    })

    it('reports unstaged modifications and untracked files', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.write('README.md', '# hello\nchanged\n')
      repo.write('new-file.txt', 'untracked\n')
      const c = await boot()
      const result = await callTool(c, 'git_status', {})
      expect(result.isError).toBe(false)
      const v = value(result)
      expect(v.isClean).toBe(false)
      expect(v.unstaged).toEqual([{ path: 'README.md', status: 'modified' }])
      expect(v.untracked).toEqual(['new-file.txt'])
    })

    it('reports staged changes', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.write('README.md', '# hello\nstaged\n')
      repo.git(['add', 'README.md'])
      const c = await boot()
      const result = await callTool(c, 'git_status', {})
      const v = value(result)
      expect(v.staged).toEqual([{ path: 'README.md', status: 'modified' }])
      expect(v.unstaged).toEqual([])
    })
  })

  describe('git_diff', () => {
    it('reports statistics for a modified file', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.write('README.md', '# hello\nline two\n')
      const c = await boot()
      const result = await callTool(c, 'git_diff', {})
      expect(result.isError).toBe(false)
      const v = value(result)
      expect(v.base).toBe('worktree')
      const files = v.files as Array<Record<string, unknown>>
      expect(files).toHaveLength(1)
      expect(files[0]!).toMatchObject({ path: 'README.md', insertions: 1, deletions: 0 })
      expect(v.totalInsertions).toBe(1)
    })

    it('includes patch text when requested', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.write('README.md', '# hello\nline two\n')
      const c = await boot()
      const result = await callTool(c, 'git_diff', { patch: true })
      expect(result.isError).toBe(false)
      const files = value(result).files as Array<{ patch?: string }>
      expect(files[0]!.patch).toContain('diff --git')
      expect(files[0]!.patch).toContain('+line two')
    })

    it('diffs the index when cached is set', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.write('README.md', '# hello\nstaged\n')
      repo.git(['add', 'README.md'])
      const c = await boot()
      const result = await callTool(c, 'git_diff', { cached: true })
      expect(result.isError).toBe(false)
      const v = value(result)
      expect(v.base).toBe('index')
      expect(v.files).toHaveLength(1)
    })
  })

  describe('git_log', () => {
    it('returns commit history with structured fields', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const c = await boot()
      const result = await callTool(c, 'git_log', {})
      expect(result.isError).toBe(false)
      const commits = value(result).commits as Array<Record<string, string>>
      expect(commits).toHaveLength(1)
      expect(commits[0]).toMatchObject({
        subject: 'initial commit',
        authorName: 'Test User',
        authorEmail: 'test@example.com',
      })
      expect(commits[0]!.hash).toMatch(/^[0-9a-f]{40}$/)
    })

    it('honors maxCount and path filtering', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.write('a.txt', 'a\n')
      repo.write('b.txt', 'b\n')
      repo.git(['add', 'a.txt', 'b.txt'])
      repo.git(['commit', '-m', 'second commit'])
      const c = await boot()
      const result = await callTool(c, 'git_log', { maxCount: 1, path: 'a.txt' })
      expect(result.isError).toBe(false)
      const commits = value(result).commits as Array<{ subject: string }>
      expect(commits).toHaveLength(1)
      expect(commits[0]!.subject).toBe('second commit')
    })
  })

  describe('git_branch', () => {
    it('lists the current branch as current', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const c = await boot()
      const result = await callTool(c, 'git_branch', {})
      expect(result.isError).toBe(false)
      const branches = value(result).branches as Array<{ name: string; current: boolean }>
      expect(branches).toEqual([{ name: 'main', current: true }])
    })
  })

  describe('git_stage + git_commit', () => {
    it('stages paths and creates a commit', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.write('README.md', '# hello\nfeature\n')
      const c = await boot()
      const staged = await callTool(c, 'git_stage', { paths: ['README.md'] })
      expect(staged.isError).toBe(false)
      const committed = await callTool(c, 'git_commit', { message: 'add feature line' })
      expect(committed.isError).toBe(false)
      const v = value(committed)
      expect(v).toMatchObject({
        committed: true,
        subject: 'add feature line',
        filesChanged: 1,
        insertions: 1,
        deletions: 0,
      })
      expect(repo.git(['log', '--oneline'])).toContain('add feature line')
    })

    it('reports nothing-to-commit without failing hard', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const c = await boot()
      const result = await callTool(c, 'git_commit', { message: 'no changes' })
      expect(result.isError).toBe(false)
      expect(value(result)).toMatchObject({ committed: false, reason: 'nothing-to-commit' })
    })
  })

  describe('git_stash', () => {
    it('pushes, lists, and pops a stash', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.write('README.md', '# hello\nwip\n')
      const c = await boot()
      const pushed = await callTool(c, 'git_stash', { action: 'push', message: 'wip' })
      expect(pushed.isError).toBe(false)
      expect(value(pushed)).toMatchObject({ action: 'push', pushed: true })
      // Working tree is clean after the push.
      const status = await callTool(c, 'git_status', {})
      expect(value(status).isClean).toBe(true)
      const listed = await callTool(c, 'git_stash', { action: 'list' })
      expect(value(listed).stashes).toHaveLength(1)
      const popped = await callTool(c, 'git_stash', { action: 'pop' })
      expect(popped.isError).toBe(false)
      expect(value(popped)).toMatchObject({ action: 'pop', applied: true })
      const after = await callTool(c, 'git_status', {})
      expect(value(after).isClean).toBe(false)
    })
  })

  describe('git_show', () => {
    it('shows a commit with metadata and stats', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const c = await boot()
      const result = await callTool(c, 'git_show', {})
      expect(result.isError).toBe(false)
      const v = value(result)
      expect(v).toMatchObject({
        subject: 'initial commit',
        authorName: 'Test User',
      })
      const files = v.files as Array<{ path: string; insertions: number }>
      expect(files[0]).toMatchObject({ path: 'README.md', insertions: 1 })
    })

    it('includes the patch when requested', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const c = await boot()
      const result = await callTool(c, 'git_show', { patch: true })
      expect(result.isError).toBe(false)
      const files = value(result).files as Array<{ patch?: string }>
      expect(files[0]!.patch).toContain('+# hello')
    })
  })

  describe('out-of-repo calls', () => {
    it('fails with a clear message outside a repository', async () => {
      repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const c = await setupPlugin({ workDir: '/tmp' })
      ctx = c
      const result = await callTool(c, 'git_status', {})
      expect(result.isError).toBe(true)
      expect(String((result as { error?: { message: string } }).error?.message ?? '')).toMatch(/not inside a git repository/)
    })
  })
})
