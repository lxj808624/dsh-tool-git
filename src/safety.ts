/**
 * Destructive-git-command safety gate.
 *
 * Registers a `tools/pre-execute` listener that inspects every tool call for
 * git operations that rewrite history or destroy work — force push, hard
 * reset, force clean, branch/tag deletion, rebase, amend, discard checkouts,
 * and friends — and denies (or asks about) them according to configuration.
 *
 * The gate inspects BOTH the plugin's own structured tools (`git_*`, e.g. a
 * `git_commit` with `amend: true`) and shell tools whose arguments carry a
 * command string (`bash`, `tool:bash`, `bash_persistent`, `terminal`,
 * `tool:terminal`, `pwsh`), so a model that reaches for plain `git push
 * --force` through bash is stopped just the same.
 *
 * This is a policy guardrail, not a sandbox: an agent that can run arbitrary
 * code can always find a way around a string matcher (aliases, `-c` rewrites,
 * scripting). The gate exists to make accidental destructive calls fail
 * loudly with an explanation — deliberate, informed destructive work is
 * authorized through the configured policy, not by bypassing the gate.
 * @module dsh-tool-git/safety
 */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'

/** What the gate does when it detects a destructive git operation. */
export type DestructivePolicy = 'deny' | 'ask' | 'allow'

/** A detected destructive operation. */
export interface DestructiveMatch {
  /** Stable identifier for the pattern, e.g. `push-force`. */
  pattern: string
  /** Human explanation of why the operation is destructive. */
  description: string
}

interface Pattern {
  id: string
  re: RegExp
  description: string
}

/**
 * Built-in destructive patterns. Each regex is anchored at a `git` invocation
 * (`\bgit(?:\.exe)?\s+<subcommand>`) and must not cross `|`, `;`, or newline
 * boundaries, so compound commands and multi-line scripts are evaluated
 * per-command rather than as one blob.
 */
const PATTERNS: Pattern[] = [
  {
    id: 'push-force',
    re: /\bgit(?:\.exe)?\s+push\b[^|\n;]*?(?:--force-with-lease|--force|-f)\b/i,
    description: 'force push overwrites the remote branch history',
  },
  {
    id: 'push-delete',
    re: /\bgit(?:\.exe)?\s+push\b[^|\n;]*?--delete\b/i,
    description: 'push --delete removes a remote branch',
  },
  {
    id: 'reset-hard',
    re: /\bgit(?:\.exe)?\s+reset\b[^|\n;]*?--hard\b/i,
    description: 'hard reset discards working tree and index changes',
  },
  {
    id: 'clean-force',
    re: /\bgit(?:\.exe)?\s+clean\b[^|\n;]*(?:^|\s)-[a-zA-Z]*f/i,
    description: 'force clean permanently deletes untracked files',
  },
  {
    id: 'branch-delete',
    re: /\bgit(?:\.exe)?\s+branch\b[^|\n;]*?-[a-zA-Z]*[dD](?:[^a-zA-Z]|$)/i,
    description: 'branch deletion removes a branch (capital -D skips the merge check)',
  },
  {
    id: 'tag-delete',
    re: /\bgit(?:\.exe)?\s+tag\b[^|\n;]*?-[a-zA-Z]*d(?:[^a-zA-Z]|$)/i,
    description: 'tag deletion removes a tag',
  },
  {
    id: 'rebase',
    re: /\bgit(?:\.exe)?\s+rebase\b/i,
    description: 'rebase rewrites commit history',
  },
  {
    id: 'checkout-discard',
    re: /\bgit(?:\.exe)?\s+checkout\b[^|\n;]*?--\b/i,
    description: 'git checkout -- discards working tree changes',
  },
  {
    id: 'checkout-force',
    re: /\bgit(?:\.exe)?\s+checkout\b[^|\n;]*?-[a-zA-Z]*f\b/i,
    description: 'force checkout discards local changes',
  },
  {
    id: 'checkout-dot',
    re: /\bgit(?:\.exe)?\s+checkout\b[^|\n;]*(?:^|\s)\.\b/i,
    description: 'git checkout . discards all working tree changes',
  },
  {
    id: 'switch-force',
    re: /\bgit(?:\.exe)?\s+switch\b[^|\n;]*?-[a-zA-Z]*f\b/i,
    description: 'force switch discards local changes',
  },
  {
    id: 'restore-discard',
    re: /\bgit(?:\.exe)?\s+restore\b[^|\n;]*?(?:\.\b|--worktree|--staged\s+--worktree)/i,
    description: 'git restore discards working tree changes',
  },
  {
    id: 'rm-force',
    re: /\bgit(?:\.exe)?\s+rm\b[^|\n;]*?-[a-zA-Z]*r\b/i,
    description: 'recursive git rm deletes files from disk',
  },
  {
    id: 'commit-amend',
    re: /\bgit(?:\.exe)?\s+commit\b[^|\n;]*?--amend\b/i,
    description: 'commit --amend rewrites the most recent commit',
  },
  {
    id: 'filter-history',
    re: /\bgit(?:\.exe)?\s+(?:filter-branch|filter-repo)\b/i,
    description: 'history filtering rewrites the entire commit graph',
  },
  {
    id: 'update-ref-delete',
    re: /\bgit(?:\.exe)?\s+update-ref\b[^|\n;]*?-[a-zA-Z]*d\b/i,
    description: 'update-ref -d deletes a ref',
  },
]

/** Shell tools whose arguments carry command text the gate should scan. */
const SHELL_TOOLS = new Set([
  'bash',
  'tool:bash',
  'bash_persistent',
  'terminal',
  'tool:terminal',
  'pwsh',
])

/** Argument keys that hold command text in shell-tool argument objects. */
const COMMAND_KEYS = ['command', 'script', 'cmd', 'text']

/** Options for {@link installSafetyGate}. */
export interface SafetyGateConfig {
  /** What to do on detection: `deny` (default), `ask`, or `allow`. */
  destructivePolicy: DestructivePolicy
  /** Extra regex strings compiled into the matcher (case-insensitive). */
  extraDestructivePatterns: string[]
}

/**
 * Scan one tool call for a destructive git operation.
 * @param name - the tool being called.
 * @param args - the frozen call arguments.
 * @param extra - compiled extra patterns (from config).
 * @returns the first match, or undefined when the call looks safe.
 */
export function findDestructiveGit(
  name: string,
  args: unknown,
  extra: readonly Pattern[] = [],
): DestructiveMatch | undefined {
  // The plugin's own tools: check the specific flags that are destructive.
  if (name === 'git_commit') {
    const amend = (args as { amend?: unknown } | null | undefined)?.amend
    if (amend === true) {
      return { pattern: 'commit-amend', description: 'amend rewrites the most recent commit' }
    }
  }
  if (!SHELL_TOOLS.has(name)) return undefined
  const text = collectCommandText(args)
  if (!text) return undefined
  for (const pattern of [...PATTERNS, ...extra]) {
    if (pattern.re.test(text)) {
      return { pattern: pattern.id, description: pattern.description }
    }
  }
  return undefined
}

/** Concatenate the command-bearing string values of a shell-tool call. */
function collectCommandText(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined
  const parts: string[] = []
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    if (COMMAND_KEYS.includes(key) && typeof value === 'string' && value.length > 0) {
      parts.push(value)
    }
  }
  return parts.length > 0 ? parts.join('\n') : undefined
}

/**
 * Compile the configured extra patterns, validating their syntax eagerly.
 * @param patterns - raw regex strings from configuration.
 * @returns the compiled patterns.
 * @throws when a pattern is not a valid regular expression.
 */
export function compileExtraPatterns(patterns: readonly string[]): Pattern[] {
  return patterns.map((raw, index) => {
    let re: RegExp
    try {
      re = new RegExp(raw, 'i')
    } catch (error) {
      throw new Error(`invalid extraDestructivePatterns[${index}]: ${(error as Error).message}`)
    }
    return { id: `extra-${index}`, re, description: `custom pattern ${raw}` }
  })
}

/**
 * Register the `tools/pre-execute` gate on a context.
 * @param ctx - registrant context carrying the tool runtime.
 * @param config - gate configuration.
 */
export function installSafetyGate(ctx: Context, config: SafetyGateConfig): void {
  const extra = compileExtraPatterns(config.extraDestructivePatterns)
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    const match = findDestructiveGit(exec.name, exec.arguments, extra)
    if (!match) return next()
    const reason =
      `Destructive git operation blocked by dsh-tool-git (${match.pattern}): `
      + `${match.description}. `
      + `Set destructivePolicy to "ask" or "allow" to permit it.`
    switch (config.destructivePolicy) {
      case 'allow':
        return next()
      case 'ask':
        return { kind: 'ask', reason }
      default:
        return { kind: 'deny', reason }
    }
  })
}
