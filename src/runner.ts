/**
 * Safe Git subprocess runner.
 *
 * Every command goes through `execFile` with an explicit argument array — no
 * shell, no string interpolation — so model-supplied paths and messages can
 * never inject shell syntax. Machine output is kept deterministic with
 * `-c core.quotepath=false` (non-ASCII paths stay unquoted UTF-8) and
 * `--no-optional-locks` (read-only commands never take advisory locks).
 * @module dsh-tool-git/runner
 */

import { execFile } from 'node:child_process'

/** One completed `git` invocation. */
export interface GitRunResult {
  /** Raw stdout bytes, decoded as UTF-8. */
  stdout: string
  /** Raw stderr bytes, decoded as UTF-8. */
  stderr: string
  /** Process exit code. */
  code: number
}

/** A `git` invocation that exited non-zero. */
export class GitError extends Error {
  /** Process exit code. */
  readonly code: number
  /** Raw stderr from the failed invocation. */
  readonly stderr: string
  /** Raw stdout from the failed invocation. */
  readonly stdout: string

  constructor(message: string, code: number, stderr: string, stdout = '') {
    super(message)
    this.name = 'GitError'
    this.code = code
    this.stderr = stderr
    this.stdout = stdout
  }
}

/** Options for {@link runGit}. */
export interface RunGitOptions {
  /** Working directory the subprocess runs in. */
  cwd: string
  /** Abort the subprocess when this signal fires. */
  signal?: AbortSignal
  /** Extra environment variables merged over `process.env`. */
  env?: NodeJS.ProcessEnv
}

/**
 * Run `git` with the given arguments and return its output.
 * @param gitPath - the `git` executable to invoke (defaults to `git`).
 * @param args - argument array; never shell-interpreted.
 * @param opts - run options.
 * @returns the raw result; callers interpret exit codes.
 */
export function runGit(gitPath: string, args: string[], opts: RunGitOptions): Promise<GitRunResult> {
  const fullArgs = ['-c', 'core.quotepath=false', '--no-optional-locks', ...args]
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    // Never block on interactive credential or editor prompts.
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'true',
    GIT_CONFIG_NOSYSTEM: '1',
    ...opts.env,
  }
  return new Promise<GitRunResult>((resolve, reject) => {
    execFile(
      gitPath,
      fullArgs,
      {
        cwd: opts.cwd,
        env,
        signal: opts.signal,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const result: GitRunResult = {
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: error && typeof (error as NodeJS.ErrnoException & { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : 0,
        }
        if (error) {
          const errno = (error as NodeJS.ErrnoException).code
          if (errno === 'ENOENT') {
            reject(new Error(`git executable not found: ${gitPath}`))
            return
          }
          if (errno === 'ABORT_ERR') {
            reject(error)
            return
          }
          // execFile reports non-zero exits as an Error carrying the exit code.
          reject(new GitError(
            (result.stderr.trim() || result.stdout.trim() || `git exited with code ${result.code}`),
            result.code,
            result.stderr,
            result.stdout,
          ))
          return
        }
        resolve(result)
      },
    )
  })
}

/**
 * Run `git` and require a zero exit code.
 * @param gitPath - the `git` executable to invoke.
 * @param args - argument array.
 * @param opts - run options.
 * @returns the raw result of the successful invocation.
 * @throws {@link GitError} when the exit code is non-zero.
 */
export async function runGitChecked(
  gitPath: string,
  args: string[],
  opts: RunGitOptions,
): Promise<GitRunResult> {
  const result = await runGit(gitPath, args, opts)
  if (result.code !== 0) {
    throw new GitError(
      result.stderr.trim() || result.stdout.trim() || `git ${args.join(' ')} exited with code ${result.code}`,
      result.code,
      result.stderr,
      result.stdout,
    )
  }
  return result
}
