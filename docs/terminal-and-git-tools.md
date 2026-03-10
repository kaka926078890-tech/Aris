# Aris 终端与 Git 工具设计

本文档描述 Aris 的**受限终端执行**与 **Git 操作**能力：边界、白名单、工作目录与安全约定。与「自己文件夹」工具同属主进程工具，工作目录与 [AGENT_FILES_DESIGN.md](AGENT_FILES_DESIGN.md) 中的 agent 根一致（当前实现为项目根 `getAgentBasePath()`）。

---

## 1. 终端能力

### 1.1 边界与限制

| 项目 | 约定 |
|------|------|
| 工作目录 | 固定为 `getAgentBasePath()`（与 agentFiles 一致，当前为项目根） |
| 白名单命令 | `ls`, `pwd`, `cat`, `head`, `tail`, `node`, `npm`, `npx` |
| npm/npx 子命令 | 仅允许 `run`, `install`, `exec`, `ci`, `test`, `start` |
| 超时 | 单次执行 30 秒，超时则终止进程并返回错误 |
| 输出 | stdout/stderr 分别截断至 16KB，超出部分以「已截断」注明 |
| 安全 | 不接收整行 shell；不执行 sh/bash；参数禁止 `..` 与绝对路径 |

### 1.2 实现位置

- 模块：`src/terminal.js`
- 导出：`runTerminalCommand({ command, args })`
- 工具名：`run_terminal_command`，在 `handler.js` 的 `AGENT_FILE_TOOLS` 中注册，由 `runAgentFileTool` 分发执行。

---

## 2. Git 能力

### 2.1 边界与限制

| 项目 | 约定 |
|------|------|
| 工作目录 | 默认 `getAgentBasePath()`；可选 `repo_path` 相对路径，解析后必须位于 agent 根下 |
| 允许子命令 | `status`, `diff`, `log`, `add`, `commit`, `pull`, `push` |
| 禁止参数 | `--force`, `-f`, `--hard`, `reset` 等；若检测到则返回「不允许的参数」 |
| 超时 | 单次 Git 命令 60 秒 |
| 输出 | stdout/stderr 分别截断至 16KB |

### 2.2 路径校验

- `repo_path` 为相对路径，禁止含 `..`。
- 解析后 `path.resolve(agentBase, repo_path)` 必须满足 `resolved.startsWith(agentBase)`（规范化后比较），否则返回「路径不允许」。

### 2.3 工具与实现

| 工具名 | 说明 | 实现函数 |
|--------|------|----------|
| `git_status` | 工作区状态 | `gitTools.gitStatus(repoPath)` |
| `git_diff` | 差异，可选 staged | `gitTools.gitDiff(repoPath, staged)` |
| `git_log` | 提交历史，max_count 默认 10 | `gitTools.gitLog(repoPath, maxCount)` |
| `git_add` | 暂存 | `gitTools.gitAdd(repoPath, paths)` |
| `git_commit` | 提交 | `gitTools.gitCommit(repoPath, message)` |
| `git_pull` | 拉取 | `gitTools.gitPull(repoPath, remote, branch)` |
| `git_push` | 推送（禁止 force） | `gitTools.gitPush(repoPath, remote, branch)` |

实现位于 `src/gitTools.js`，在 `handler.js` 中注册并分发。

---

## 3. 与 AGENT_FILES_DESIGN 的衔接

- **同属主进程工具**：终端与 Git 工具均在主进程执行，与 `list_my_files`、`read_file`、`write_file` 一致；无需 preload/IPC 暴露。
- **同目录边界**：工作目录统一使用 `getAgentBasePath()`（来自 `agentFiles.js`），与「自己文件夹」范围一致。
- **多轮工具**：终端与 Git 工具参与同一多轮工具循环（`MAX_TOOL_ROUNDS`），可与文件工具在同一轮对话中连续调用，直到无 tool_calls 或达到轮数上限。
