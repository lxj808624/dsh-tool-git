/**
 * Registry of the structured git tools, bound to plugin configuration.
 * @module dsh-tool-git/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineBranchTool } from './branch.ts'
import { defineCommitTool } from './commit.ts'
import { defineDiffTool, type DiffToolOptions } from './diff.ts'
import { defineLogTool, type LogToolOptions } from './log.ts'
import { defineShowTool, type ShowToolOptions } from './show.ts'
import { defineStageTool } from './stage.ts'
import { defineStashTool } from './stash.ts'
import { defineStatusTool } from './status.ts'
import type { ToolOptions } from './context.ts'

/** Plugin configuration consumed by the tool registry. */
export interface ToolsConfig extends ToolOptions {
  /** Default commit count for `git_log` when the caller omits `maxCount`. */
  logMaxCommits: number
  /** Default unified-diff context lines for `git_diff` / `git_show` patches. */
  diffContextLines: number
}

/** Register every git tool on the context's tool registry. */
export function registerGitTools(ctx: Context, config: ToolsConfig): void {
  const options: ToolOptions = { gitPath: config.gitPath, workDir: config.workDir }
  const diffOptions: DiffToolOptions = { ...options, diffContextLines: config.diffContextLines }
  const logOptions: LogToolOptions = { ...options, logMaxCommits: config.logMaxCommits }
  const showOptions: ShowToolOptions = { ...options, diffContextLines: config.diffContextLines }
  const definitions = [
    defineStatusTool(options),
    defineDiffTool(diffOptions),
    defineLogTool(logOptions),
    defineBranchTool(options),
    defineStageTool(options),
    defineCommitTool(options),
    defineStashTool(options),
    defineShowTool(showOptions),
  ]
  for (const definition of definitions) {
    ctx.tools.register(definition)
  }
}
