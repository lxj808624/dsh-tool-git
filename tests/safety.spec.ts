import { afterEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { callTool, makeTempRepo, setupPlugin, type TempRepo } from './helpers.ts'

/** A stand-in for the runtime's bash tool so the gate has shell commands to scan. */
function registerFakeBash(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'bash',
    description: 'run a shell command',
    parameters: { command: { type: 'string', required: true } },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args) {
      return `ran: ${args.command}`
    },
  }))
}

describe('dsh-tool-git destructive-command gate', () => {
  let repo: TempRepo
  const cleanup: Array<() => void> = []

  afterEach(() => {
    for (const fn of cleanup.splice(0)) fn()
    repo?.cleanup()
  })

  async function boot(config?: Parameters<typeof setupPlugin>[0]): Promise<Context> {
    const ctx = await setupPlugin({ workDir: repo.dir, ...config })
    return ctx
  }

  describe('deny policy (default)', () => {
    it('blocks a force push issued through a shell tool', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      registerFakeBash(ctx)
      const result = await callTool(ctx, 'bash', { command: 'git push --force origin main' })
      expect(result.isError).toBe(true)
      const message = (result as { error?: { message: string } }).error?.message ?? ''
      expect(message).toMatch(/blocked by dsh-tool-git \(push-force\)/)
      expect(message).toMatch(/force push/)
    })

    it('blocks --force-with-lease as well', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      registerFakeBash(ctx)
      const result = await callTool(ctx, 'bash', { command: 'git push --force-with-lease' })
      expect(result.isError).toBe(true)
    })

    it('blocks hard reset', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      registerFakeBash(ctx)
      const result = await callTool(ctx, 'bash', { command: 'git reset --hard HEAD~1' })
      expect(result.isError).toBe(true)
      expect((result as { error?: { message: string } }).error?.message).toMatch(/\(reset-hard\)/)
    })

    it('blocks rebase and amend', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      registerFakeBash(ctx)
      for (const command of ['git rebase main', 'git commit --amend -m x', 'git pull --rebase']) {
        const result = await callTool(ctx, 'bash', { command })
        expect(result.isError, `expected blocked: ${command}`).toBe(true)
      }
    })

    it('blocks destructive branch deletion but allows safe branch ops', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      registerFakeBash(ctx)
      const blocked = await callTool(ctx, 'bash', { command: 'git branch -D feature' })
      expect(blocked.isError).toBe(true)
      const allowed = await callTool(ctx, 'bash', { command: 'git branch feature' })
      expect(allowed.isError).toBe(false)
    })

    it('does not block benign git commands', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      registerFakeBash(ctx)
      for (const command of [
        'git status',
        'git diff',
        'git log --oneline',
        'git push origin main',
        'git checkout feature',
        'git stash list',
      ]) {
        const result = await callTool(ctx, 'bash', { command })
        expect(result.isError, `expected safe: ${command}`).toBe(false)
      }
    })

    it('does not treat a plain git commit as destructive', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      const result = await callTool(ctx, 'git_commit', { message: 'safe commit' })
      expect(result.isError).toBe(false)
    })

    it('blocks amend through the plugin tool itself', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      const result = await callTool(ctx, 'git_commit', { message: 'amend me', amend: true })
      expect(result.isError).toBe(true)
      expect((result as { error?: { message: string } }).error?.message).toMatch(/\(commit-amend\)/)
    })

    it('does not cross ; or | boundaries when scanning compound commands', async () => {
      repo = makeTempRepo()
      const ctx = await boot()
      registerFakeBash(ctx)
      // `git push --force` separated by a pipe from a benign git command is still caught.
      const caught = await callTool(ctx, 'bash', { command: 'git status | git push --force' })
      expect(caught.isError).toBe(true)
      // A force push chained with && is caught too (the regex re-anchors per git invocation).
      const chained = await callTool(ctx, 'bash', { command: 'git add . && git push --force' })
      expect(chained.isError).toBe(true)
    })
  })

  describe('ask policy', () => {
    it('degrades to deny when no approval service is mounted', async () => {
      repo = makeTempRepo()
      const ctx = await boot({ destructivePolicy: 'ask' })
      registerFakeBash(ctx)
      const result = await callTool(ctx, 'bash', { command: 'git push --force' })
      expect(result.isError).toBe(true)
    })
  })

  describe('allow policy', () => {
    it('lets destructive commands through when explicitly allowed', async () => {
      repo = makeTempRepo()
      const ctx = await boot({ destructivePolicy: 'allow' })
      registerFakeBash(ctx)
      const result = await callTool(ctx, 'bash', { command: 'git push --force origin main' })
      expect(result.isError).toBe(false)
      expect(result.value).toBe('ran: git push --force origin main')
    })
  })

  describe('extra patterns', () => {
    it('matches configured custom patterns', async () => {
      repo = makeTempRepo()
      const ctx = await boot({ extraDestructivePatterns: ['git\\s+push\\s+origin\\s+[^ ]+\\s+--delete'] })
      registerFakeBash(ctx)
      const result = await callTool(ctx, 'bash', { command: 'git push origin main --delete' })
      expect(result.isError).toBe(true)
    })

    it('rejects invalid regexes at apply time', async () => {
      repo = makeTempRepo()
      await expect(setupPlugin({ workDir: repo.dir, extraDestructivePatterns: ['('] }))
        .rejects.toThrow(/invalid extraDestructivePatterns/)
    })
  })
})
