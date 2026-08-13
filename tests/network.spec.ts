import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { callTool, makeBareRepo, makeClone, makeTempRepo, setupPlugin, type TempRepo } from './helpers.ts'

type Result = Awaited<ReturnType<typeof callTool>>
const value = (result: Result): Record<string, unknown> => result.value as Record<string, unknown>

describe('dsh-tool-git network & branch tools', () => {
  const cleanup: Array<() => void> = []

  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn()
  })

  async function boot(repo: TempRepo): Promise<Context> {
    return setupPlugin({ workDir: repo.dir })
  }

  describe('git_remote', () => {
    it('reports an empty list without remotes and the configured remote after add', async () => {
      const repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const ctx = await boot(repo)
      const empty = await callTool(ctx, 'git_remote', {})
      expect(empty.isError).toBe(false)
      expect(value(empty).remotes).toEqual([])
      const bare = makeBareRepo()
      cleanup.push(bare.cleanup)
      repo.git(['remote', 'add', 'origin', bare.dir])
      const listed = await callTool(ctx, 'git_remote', {})
      expect(value(listed).remotes).toEqual([{ name: 'origin', url: bare.dir }])
    })
  })

  describe('git_fetch', () => {
    it('downloads upstream refs without touching the worktree', async () => {
      const remote = makeBareRepo()
      cleanup.push(remote.cleanup)
      const repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.git(['remote', 'add', 'origin', remote.dir])
      repo.git(['push', '-u', 'origin', 'main'])
      const upstream = makeClone(remote.dir)
      cleanup.push(upstream.cleanup)
      upstream.write('new.txt', 'from upstream\n')
      upstream.git(['add', '.'])
      upstream.git(['commit', '-m', 'upstream change'])
      upstream.git(['push'])

      const ctx = await boot(repo)
      const before = repo.git(['rev-parse', 'main'])
      const result = await callTool(ctx, 'git_fetch', {})
      expect(result.isError).toBe(false)
      const v = value(result)
      expect(v.remote).toBeNull()
      expect(String(v.output)).toContain('main')
      // The worktree branch is untouched; the remote-tracking ref moved.
      expect(repo.git(['rev-parse', 'main'])).toBe(before)
      const fetched = repo.git(['rev-parse', 'origin/main'])
      expect(fetched).not.toBe(before)
    })
  })

  describe('git_pull', () => {
    it('fast-forwards the current branch', async () => {
      const remote = makeBareRepo()
      cleanup.push(remote.cleanup)
      const repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.git(['remote', 'add', 'origin', remote.dir])
      repo.git(['push', '-u', 'origin', 'main'])
      const upstream = makeClone(remote.dir)
      cleanup.push(upstream.cleanup)
      upstream.write('new.txt', 'from upstream\n')
      upstream.git(['add', '.'])
      upstream.git(['commit', '-m', 'upstream change'])
      upstream.git(['push'])

      const ctx = await boot(repo)
      const result = await callTool(ctx, 'git_pull', {})
      expect(result.isError).toBe(false)
      expect(value(result)).toMatchObject({ pulled: true })
      expect(repo.git(['rev-parse', 'main'])).toBe(repo.git(['rev-parse', 'origin/main']))
      expect(repo.git(['log', '--oneline'])).toContain('upstream change')
    })

    it('reports not-fast-forward instead of failing when branches diverged', async () => {
      const remote = makeBareRepo()
      cleanup.push(remote.cleanup)
      const repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      repo.git(['remote', 'add', 'origin', remote.dir])
      repo.git(['push', '-u', 'origin', 'main'])
      const upstream = makeClone(remote.dir)
      cleanup.push(upstream.cleanup)
      upstream.write('u.txt', 'upstream\n')
      upstream.git(['add', '.'])
      upstream.git(['commit', '-m', 'upstream change'])
      upstream.git(['push'])
      // Local divergent commit.
      repo.write('local.txt', 'local\n')
      repo.git(['add', '.'])
      repo.git(['commit', '-m', 'local change'])

      const ctx = await boot(repo)
      const result = await callTool(ctx, 'git_pull', {})
      expect(result.isError).toBe(false)
      expect(value(result)).toMatchObject({ pulled: false, reason: 'not-fast-forward' })
    })
  })

  describe('git_checkout', () => {
    it('creates and switches to a new branch, then switches back', async () => {
      const repo = makeTempRepo()
      cleanup.push(repo.cleanup)
      const ctx = await boot(repo)
      const created = await callTool(ctx, 'git_checkout', { branch: 'feature', create: true })
      expect(created.isError).toBe(false)
      expect(value(created)).toMatchObject({ branch: 'feature', created: true })
      expect(repo.git(['branch', '--show-current']).trim()).toBe('feature')
      const switched = await callTool(ctx, 'git_checkout', { branch: 'main' })
      expect(value(switched)).toMatchObject({ branch: 'main', created: false })
      expect(repo.git(['branch', '--show-current']).trim()).toBe('main')
    })
  })
})
