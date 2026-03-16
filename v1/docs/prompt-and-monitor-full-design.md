# Aris 提示词与监控完整方案 — 设计文档

本文档为「提示词常驻/工具化划分、用户身份与要求、监控（Token 与文件修改）」的完整设计与实现说明。对应实现已完成，按阶段 1→6 执行。

---

## 一、提示词内容：常驻 vs 工具

- **常驻每轮**：人设与情感表达要求；**【用户身份】**（仅权威存储，完整）；**【用户要求】**（完整「用户要求总结」）；**【当前会话最近 3–5 轮】**；**【行为规则】**。
- **按需工具**：`get_current_time`、`get_corrections`、`search_memories`、`get_cross_session_dialogue`。与时间/日期、纠错、长时记忆、跨会话相关的内容不再每轮注入 system，改为模型按需调用工具获取。

---

## 二、用户身份：完整、不随意改、变更可观测

- **存储**：`memory/user_identity.json` 为唯一权威身份源，包含 `name` 与 `notes`，完整注入。
- **更新入口**：仅在用户明确说「我叫/我是/你可以叫我 XXX」或「身份是 XXX」时，才调用 `updateUserIdentityFromMessage` 写回；不再从检索记忆中抽取名字写回身份。
- **【用户身份】** 只来自 `loadUserIdentity()`，与**【用户要求】** 分块展示。

### 身份变更后门日志（排查触发场景）

- **位置**：项目根下 `memory/identity_change_log.json`（与 `user_identity.json` 同目录）。
- **结构**：JSON 数组，每项为一次身份写回记录，字段：
  - `timestamp`：ISO 时间
  - `trigger_type`：如 `"user_message"`
  - `trigger_summary`：触发内容摘要（如用户消息前 200 字）
  - `name_before`：写回前的名字（若有）
  - `name_after`：写回后的名字（若有）
- **用途**：观察「什么情况下会触发身份更改」。若发现非预期触发，可根据 `trigger_summary` 与 `trigger_type` 回溯到具体用户输入或流程，便于调整匹配规则或调用时机。

---

## 三、用户要求：完整、总结并更新

- **常驻内容**：每轮 system 中**【用户要求】**来自 `memory/user_requirements_summary.md`，不设条数/字数上限，不删减。
- **更新流程**：用户发送新消息且被识别为「要求」时，`appendRequirementToIdentity` + 写入 `user_requirement` 向量记忆后，调用 `updateUserRequirementsSummary()`，合并 `user_requirement` 与 identity notes 中的「用户要求」行，去重后写回总结文件。
- **实现**：`src/dialogue/userRequirementsSummary.js`（`loadUserRequirementsSummary`、`updateUserRequirementsSummary`）。

---

## 四、对话轮次与检索

- **当前会话**：最近 **5 轮**（`RECENT_ROUNDS = 5`），即最多 10 条消息注入 context。
- **向量检索**：`retrieve(query, limit)` 默认 `limit = 5`；工具 `search_memories` 默认返回 5 条，总长限制 1500 字。

---

## 五、工具

| 工具 | 说明 |
|------|------|
| `get_current_time` | 获取当前日期时间，回答与时间/日期相关问题时先调用。 |
| `get_corrections` | 获取用户曾指出的理解偏差，避免重复。 |
| `search_memories` | 按语义检索记忆，参数 `query`、`limit`（默认 5）。 |
| `get_cross_session_dialogue` | 获取近期其他会话对话，参数 `limit`（默认 20）。 |

行为规则见 `src/dialogue/rules.md`。

---

## 六、监控：Token 与文件修改

- **Token 记录**：每轮对话结束后在 handler 中调用 `recordTokenUsage(sessionId, roundId, inputTokens, outputTokens, isEstimated)`。当前未从 API 获取 usage 时使用字符数/4 估算，`isEstimated = true`。数据存于用户目录下 `monitor/token_usage.json`。
- **文件修改记录**：任何写文件成功路径（`write_file` 工具、identity 写入、用户要求总结写入、identity_change_log 写入等）调用 `recordFileModification(relativePath)`。数据存于用户目录下 `monitor/file_modifications.json`。
- **监控面板**：菜单「视图 → 打开监控面板」，两 Tab：Token 统计（按日/会话筛选、汇总）、文件修改（路径、修改次数、最后修改时间，按路径筛选）。

---

## 七、关键文件

| 文件 | 说明 |
|------|------|
| `src/dialogue/userIdentity.js` | 身份读写；写回时追加 `identity_change_log`；写 identity 后调用 `recordFileModification('memory/user_identity.json')`。 |
| `src/dialogue/userRequirementsSummary.js` | 用户要求总结的读取与更新；写总结后调用 `recordFileModification('memory/user_requirements_summary.md')`。 |
| `src/dialogue/handler.js` | buildPromptContext 仅用 identity + 要求总结 + 最近 5 轮 + windowTitle；新工具注册与执行；每轮结束 recordTokenUsage；write_file 成功 recordFileModification。 |
| `src/dialogue/prompt.js` | CONTEXT_TEMPLATE 仅保留 user_identity、user_requirements、window_title、last_state_and_subjective_time、context_window、behavioral_rules。 |
| `src/store/monitor.js` | recordTokenUsage、recordFileModification、getTokenUsageRecords、getFileModifications。 |
| `src/renderer/monitor.html` + `preload.monitor.js` | 监控面板 UI 与只读 API。 |
| `electron.main.js` | monitor 窗口与「打开监控面板」菜单项；IPC `monitor:getTokenUsage`、`monitor:getFileModifications`。 |

---

以上为完整设计与实现要点；身份变更排查以 `memory/identity_change_log.json` 为准。
