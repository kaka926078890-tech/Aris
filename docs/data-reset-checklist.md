# Aris 数据重置检查清单

重置/归档后，可按此清单核对是否还有遗漏的数据位置。**仅做检查用，不自动修改。**

---

## 一、项目内（仓库 `memory/` 目录）

这些路径在项目源码树下，你已归档或删除的即已处理。

| 路径 | 用途 | 代码位置 |
|------|------|----------|
| `memory/user_identity.json` | 用户身份（姓名、notes） | `userIdentity.js` |
| `memory/identity_change_log.json` | 身份变更日志 | `userIdentity.js` |
| `memory/user_requirements_summary.md` | 用户要求摘要（每轮注入 prompt） | `userRequirementsSummary.js` |
| `memory/self_upgrade_log.md` | 自升级执行日志 | `selfUpgrade.js` |

**说明**：若这些文件在重置时被删掉，下次运行会在「首次需要写入时」再创建；若目录下还有其它你之前用过的文件（如 `user_name.txt`、`emotional_records.md` 等），可按需一并清理或归档。

---

## 二、用户数据目录（与备份/恢复独立）

以下数据在 **Electron userData** 或 **`process.cwd()/data/aris`**（无 Electron 时），**不会**被项目内 `memory/` 的删除影响，需单独确认是否要清空。

- **Electron**：`app.getPath('userData')/aris`（如 macOS 上 `~/Library/Application Support/aris`）
- **非 Electron**：项目下的 `data/aris`

| 路径（相对 userData 根） | 用途 | 代码位置 |
|--------------------------|------|----------|
| `aris.db` | SQLite：会话列表、每轮对话内容、`current_session_id` 等设置 | `store/db.js`, `store/conversations.js` |
| `lancedb/` | 向量库：对话轮次、用户要求、纠错、情感、表达欲望等 | `memory/lancedb.js` |
| `aris_state.json` | 上次活跃时间、最近心理状态 | `context/arisState.js` |
| `aris_proactive_state.json` | 主动消息状态（是否下班、今日是否自升级等） | `context/arisState.js` |
| `monitor/token_usage.json` | Token 使用记录 | `store/monitor.js` |
| `monitor/file_modifications.json` | 文件修改记录 | `store/monitor.js` |

**若要做「完全重置」**：需清空或删除上述 userData 目录下的这些文件/目录；仅重置项目内 `memory/` 不会动到会话历史、向量记忆和状态文件。

---

## 三、备份/恢复覆盖范围（`store/backup.js`）

- **导出（.aris）**：包含 `aris.db` 的 base64 + LanceDB 内存条目的 JSON，**不包含**项目内 `memory/*.json`、`memory/*.md`。
- **导入**：会覆盖 `aris.db` 和 LanceDB，**不会**覆盖或删除 `memory/user_identity.json`、`memory/user_requirements_summary.md` 等。

因此：若通过「从空白/新备份恢复」来做重置，只会清掉会话库和向量记忆；项目内身份与要求摘要等需在 `memory/` 下自行删除或归档。

---

## 四、建议核对项（重置后）

1. **项目内**：`memory/` 下是否还有不需要的旧文件（含 `user_identity.json`、`identity_change_log.json`、`user_requirements_summary.md`、`self_upgrade_log.md` 等）。
2. **用户数据目录**：是否需要清空 `aris.db`、`lancedb/`、`aris_state.json`、`aris_proactive_state.json`、`monitor/`。
3. **环境变量**：若使用 `ARIS_DATA_DIR` 指向自定义目录，该目录下的上述文件也需一并检查。
