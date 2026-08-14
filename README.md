# dsh-tool-git

Structured, safe Git tool family for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

Coding agents reach for git constantly, but the stock runtime only offers raw `bash`.
`dsh-tool-git` gives the model eight structured tools that run `git` through a
shell-free subprocess runner and return canonical JSON values — plus a
`tools/pre-execute` safety gate that stops destructive git operations
(force push, hard reset, rebase, amend, branch deletion, …) before they happen,
whether the model calls them through these tools **or** through a shell tool.

- **No shell injection**: every command goes through `execFile` with an explicit
  argument array. Model-supplied paths and messages are never string-interpolated.
- **Machine output**: porcelain v2, `--numstat`, and `--format` records are parsed
  into structured JSON, not prose.
- **Safety by default**: destructive operations are denied with an explanation
  unless you opt into `ask` (approval prompt) or `allow`.

## Tools

| Tool | What it does |
|---|---|
| `git_status` | Working tree state: branch, ahead/behind, staged / unstaged / untracked files |
| `git_diff` | Per-file insertion/deletion stats, optional unified patch, `--cached` / `rev` bases |
| `git_log` | Commit history: hash, author, date, subject, body; `maxCount`, `rev` range, `path` filter |
| `git_branch` | Branches with upstream and ahead/behind tracking state |
| `git_stage` | Stage explicit paths, or all / tracked-only changes |
| `git_commit` | Create a commit with a message; returns hash and statistics |
| `git_stash` | `list` / `push` / `pop` stashes, with conflict-safe pop |
| `git_show` | One commit: metadata, per-file stats, optional patch |
| `git_fetch` | Download refs from a remote without touching the worktree |
| `git_pull` | Fast-forward-only by default; reports `not-fast-forward` / `conflict` outcomes |
| `git_remote` | List configured remotes with fetch/push URLs |
| `git_checkout` | Switch branches, or create and switch (`-b`); never discards changes |

Every tool accepts an optional `repoDir` argument and reports the resolved
repository root in its result.

## Safety gate

The gate listens on `tools/pre-execute` and inspects every tool call:

- **The plugin's own tools** — e.g. `git_commit` with `amend: true`.
- **Shell tools** — `bash`, `tool:bash`, `bash_persistent`, `terminal`,
  `tool:terminal`, `pwsh` — scanning their command text for destructive git
  invocations such as:

  `push --force` / `--force-with-lease` · `push --delete` · `reset --hard` ·
  `clean -f` · `branch -d/-D` · `tag -d` · `rebase` · `pull --rebase` ·
  `commit --amend` · `checkout --` / `checkout .` / `checkout -f` ·
  `switch -f` · `restore` (discarding worktree) · `rm -r` ·
  `update-ref -d` · `filter-branch`

  Pattern matching is per-command: it never crosses `|`, `;`, or newline
  boundaries, so `git add . && git push --force` is still caught but innocent
  compound commands are not misread.

**This is a policy guardrail, not a sandbox.** An agent that can run arbitrary
code can always route around a string matcher (aliases, `-c` rewrites,
scripting). The gate exists to make accidental destructive calls fail loudly
with an explanation — deliberate destructive work is authorized through the
configured policy, not by bypassing the gate.

## Install

**npm (recommended)** — from any directory:

```sh
dsh plugin --profile web add dsh-tool-git
```

**From GitHub** (or a local checkout / tarball):

```sh
dsh plugin --profile web add github:lxj808624/dsh-tool-git#v0.1.2
```

Then restart `dsh --profile web`. For GitHub installs, pnpm asks you to
allowlist the `prepare` build script once (see the
[official packaging guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)).

## Configuration

All options are optional; the defaults are shown below:

```yaml
# profile-level or bundle patch config for the tool-git row
- id: tool-git
  name: dsh-tool-git
  config:
    workDir: ''                # repo discovery start dir (default: process cwd)
    gitPath: git               # git executable
    destructivePolicy: deny    # deny | ask | allow
    extraDestructivePatterns: []  # extra case-insensitive regexes for the gate
    logMaxCommits: 20          # git_log default count (cap 100)
    diffContextLines: 3        # patch context lines for git_diff / git_show
```

- `deny` (default) — destructive calls are rejected with the pattern name and
  an explanation.
- `ask` — destructive calls go through the runtime's approval seam
  (`ctx.approval`); without a mounted approval service they degrade to `deny`.
- `allow` — the gate passes everything through.

## Development

Prerequisites: Node.js ≥ 22.19 and pnpm. The project is self-contained — all
`@deepseek-ai/*` types resolve from the published public API (0.0.1-rc.5 line)
installed as devDependencies, so no `deepseek-harness` checkout is required.

```sh
pnpm install
pnpm run typecheck   # tsc against the public @deepseek-ai/* API
pnpm test            # vitest: boots the plugin, runs real git in temp repos
pnpm run build       # tsc declarations + tsdown bundle (lib/index.mjs)
```

The tests create a disposable repository, register the plugin on a Cordis
context with the real `dsh-tools` runtime, and execute every tool through the
full pipeline (`tools/pre-execute` → dispatch → `tools/result`).

## Publish

- `dsh.bundle.patch` in `package.json` points at `cordis.patch.yml`, so
  `dsh plugin add` activates the plugin as a profile layer.
- `prepare` runs `tsdown --config tsdown.prepare.config.ts`, which transpiles
  `src/` without project references — so GitHub installs build cleanly without
  a sibling harness checkout. Prefer publishing prebuilt tarballs / npm
  packages to avoid pnpm's build-script allowlist.

## License

[MIT](LICENSE)
