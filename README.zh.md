# dsh-tool-git

[![npm](https://img.shields.io/npm/v/dsh-tool-git?logo=npm)](https://www.npmjs.com/package/dsh-tool-git)
[![CI](https://img.shields.io/github/actions/workflow/status/lxj808624/dsh-tool-git/ci.yml?branch=main&logo=githubactions&logoColor=white&label=CI)](https://github.com/lxj808624/dsh-tool-git/actions)
[![License](https://img.shields.io/npm/l/dsh-tool-git)](LICENSE)
[![awesome-deepseek-harness](https://img.shields.io/badge/awesome--deepseek--harness-listed-4D6BFE)](https://github.com/0xsline/awesome-deepseek-harness)
[![GitHub stars](https://img.shields.io/github/stars/lxj808624/dsh-tool-git?style=social)](https://github.com/lxj808624/dsh-tool-git)

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）开发的结构化、安全 Git 工具插件。

编码 agent 几乎每天都在用 git，但 dsh 默认只提供裸 `bash` 命令。`dsh-tool-git` 为模型提供八个结构化工具——通过无 shell 的子进程运行器执行 `git`，返回规范的 JSON 值——并内置 `tools/pre-execute` 安全门，在破坏性 git 操作（强制推送、硬重置、rebase、amend、删除分支等）发生之前将其拦截，无论模型是通过这些工具调用，还是**通过 shell 工具**调用。

- **无 shell 注入**：所有命令通过 `execFile` + 显式参数数组执行，模型提供的路径和消息永远不会被字符串拼接进 shell。
- **机器可读输出**：porcelain v2、`--numstat`、`--format` 记录被解析为结构化 JSON，而不是文本。
- **默认安全**：破坏性操作默认被拒绝并附带原因说明，除非你选择 `ask`（审批弹窗）或 `allow`（放行）。

## 工具列表

| 工具 | 功能 |
|---|---|
| `git_status` | 工作区状态：分支、领先/落后、已暂存 / 未暂存 / 未跟踪文件 |
| `git_diff` | 逐文件增删统计、可选 unified patch、`--cached` / `rev` 基线 |
| `git_log` | 提交历史：哈希、作者、日期、主题、正文；支持 `maxCount`、`rev` 区间、`path` 过滤 |
| `git_branch` | 分支列表及上游跟踪状态（领先/落后） |
| `git_stage` | 暂存指定路径，或全部 / 仅已跟踪的修改 |
| `git_commit` | 用消息创建提交；返回哈希和统计 |
| `git_stash` | `list` / `push` / `pop` 暂存，pop 冲突安全处理 |
| `git_show` | 单次提交：元数据、逐文件统计、可选 patch |
| `git_fetch` | 从远端下载引用，不触碰工作区 |
| `git_pull` | 默认仅快进；`not-fast-forward` / `conflict` 结果结构化返回 |
| `git_remote` | 列出已配置的远端（fetch/push URL） |
| `git_checkout` | 切换分支或创建并切换（`-b`）；绝不丢弃更改 |

每个工具都接受可选的 `repoDir` 参数，并在结果中返回解析后的仓库根目录。

## 安全门

安全门监听 `tools/pre-execute`，检查每一次工具调用：

- **插件自身的工具** —— 例如带 `amend: true` 的 `git_commit`。
- **shell 工具** —— `bash`、`tool:bash`、`bash_persistent`、`terminal`、`tool:terminal`、`pwsh` —— 扫描其命令文本中的破坏性 git 调用，例如：

  `push --force` / `--force-with-lease` · `push --delete` · `reset --hard` ·
  `clean -f` · `branch -d/-D` · `tag -d` · `rebase` · `pull --rebase` ·
  `commit --amend` · `checkout --` / `checkout .` / `checkout -f` ·
  `switch -f` · `restore`（丢弃工作区）· `rm -r` · `update-ref -d` · `filter-branch`

  模式匹配按命令进行：不会跨越 `|`、`;` 或换行边界，因此 `git add . && git push --force` 仍会被拦截，而普通的复合命令不会被误判。

**这是策略护栏，不是沙箱。** 能运行任意代码的 agent 总有办法绕过字符串匹配（别名、`-c` 改写、脚本化）。护栏的意义在于让**意外**的破坏性调用响亮地失败并给出解释——有意的破坏性操作通过配置的策略来授权，而不是绕过护栏。

## 安装

**npm（推荐）** —— 任意目录执行：

```sh
dsh plugin --profile web add dsh-tool-git
```

**从 GitHub**（或本地目录 / tarball）：

```sh
dsh plugin --profile web add github:lxj808624/dsh-tool-git#v0.1.2
```

然后重启 `dsh --profile web`。通过 GitHub 安装时，pnpm 会要求你允许一次 `prepare` 构建脚本（参见[官方打包指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)）。

## 配置

所有选项均可选，默认值如下：

```yaml
# tool-git 行的 profile 级或 bundle patch 配置
- id: tool-git
  name: dsh-tool-git
  config:
    workDir: ''                # 仓库发现起始目录（默认：进程 cwd）
    gitPath: git               # git 可执行文件
    destructivePolicy: deny    # deny | ask | allow
    extraDestructivePatterns: []  # 追加的忽略大小写正则（安全门使用）
    logMaxCommits: 20          # git_log 默认条数（上限 100）
    diffContextLines: 3        # git_diff / git_show 的 patch 上下文行数
```

- `deny`（默认）—— 破坏性调用被拒绝，并附带模式名和原因说明。
- `ask` —— 破坏性调用走运行时的审批通道（`ctx.approval`）；未挂载审批服务时降级为 `deny`。
- `allow` —— 安全门全部放行。

## 开发

前置条件：Node.js ≥ 22.19 和 pnpm。项目完全自包含——所有 `@deepseek-ai/*` 类型来自 devDependencies 中安装的公开 API（0.0.1-rc.5 线），**不需要** `deepseek-harness` checkout。

```sh
pnpm install
pnpm run typecheck   # 针对公开 @deepseek-ai/* API 做 tsc 检查
pnpm test            # vitest：启动插件，在临时仓库中执行真实 git
pnpm run build       # tsc 声明 + tsdown 打包（lib/index.mjs）
```

测试会创建一次性仓库，把插件注册到带有真实 `dsh-tools` 运行时的 Cordis 上下文上，并通过完整管线（`tools/pre-execute` → dispatch → `tools/result`）执行每个工具。

## 发布

- `package.json` 中的 `dsh.bundle.patch` 指向 `cordis.patch.yml`，因此 `dsh plugin add` 会把插件作为 profile 层激活。
- `prepare` 运行 `tsdown --config tsdown.prepare.config.ts`，无需项目引用即可从 `src/` 转译——因此 GitHub 安装无需相邻 harness checkout 也能构建。更推荐发布预构建 tarball / npm 包，避免 pnpm 的构建脚本白名单。

## License

[MIT](LICENSE)
