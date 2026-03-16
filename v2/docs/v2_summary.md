# Aris v2 版本总结与待办

## 一、v2 已实现内容总结

### 1. 架构与原则
- **与现网隔离**：v2 不引用项目根 `src/`，数据目录独立（Electron userData/aris-v2 或 v2/data）。
- **记录由 LLM 驱动**：用户身份、用户要求、纠错、情感、表达欲望**仅**通过 LLM 调用对应工具写入；**禁止**代码内用正则/关键词从用户或助手消息解析并自动写入。
- **记忆存储与 v1 一致**：对话库 **SQLite**（表结构同 v1）、向量库 **LanceDB**；仅路径与封装在 v2。向量数据只存向量库，不写入 .md。

### 2. 目录与模块
- **packages/config**：paths（数据目录、memory、SQLite、LanceDB、state 路径）、constants（向量权重、前缀、拼接轮数等）。
- **packages/store**：identity、requirements、corrections、emotions、expressionDesires（JSON 文件）；conversations（SQLite）、db；state（aris_state、aris_proactive_state）；vector（LanceDB + embed、add、search、getRecentByType，含 search_document/search_query 前缀与时间衰减）。每模块有对应 docs/*.md。
- **packages/server**：llm/client（chat、chatWithTools）、llm/stream（chatStream）；dialogue/prompt（方案 A：首轮完整，后续轮人设+规则+工具每轮保留，身份/要求用简短摘要）；dialogue/tools（record、file、memory、time）及 index 注册与分发；dialogue/handler（收消息→组 prompt→LLM→执行工具→写 conversations/向量块/state，无解析写入）。
- **apps/electron**：main、preload、config、backup（导出/导入 .aris = SQLite + LanceDB）；菜单导出/导入记忆；IPC 对话、历史、清空。
- **apps/renderer**：简易对话页（index.html + Tailwind，明亮风格），输入、发送、流式展示、onProactive；package.json 已配置 Vite/React/Tailwind/lucide，便于扩展管理页。

### 3. 提示词策略（方案 A）
- 首轮：完整 system prompt（人设、规则、身份、要求、上次状态与时间、当前会话）。
- 后续轮：人设+规则+工具定义每轮保留；身份/要求用 store 读出的简短摘要注入。若后续改为方案 B，需更新 prompt.js 与 prompt_strategy.md。

### 4. 向量设计（已实现部分）
- 结构化拼接块：每轮写入「上一轮+本轮」对话块，embed 时加 search_document 前缀，写入 type=dialogue_turn。
- Query/Document 前缀：存时 search_document:，查时 search_query:。
- 时间衰减：检索得分 = 相似度×0.7 + 时间因子×0.3。
- 未实现：每 5～10 轮摘要向量、意图/事实多向量（见待办）。

### 5. Proactive（Phase 6）
- **Electron**：每 3 分钟定时器；空闲超过 2 分钟且非对话中时调用 maybeProactiveMessage。
- **server/dialogue/proactive.js**：读 store.state（readProactiveState/readState）、store.emotions.getRecent、store.expressionDesires.getRecent、store.conversations.getRecent；优先使用高优先级表达欲望直接发话，否则用 LLM「是否想说话」prompt 生成一句；写回 conversations、state、vector（aris_behavior）；低功耗/未回应计数（满 3 轮未回复则 low_power_mode）。用户发消息时 handler 已重置 proactive_no_reply_count 与 low_power_mode。

### 6. 文档
- docs/todo.md：分阶段执行清单，已勾选 Phase 0～6 已完成项。
- docs/prompt_strategy.md、architecture.md、store.md、vector_design.md、tools.md、ui_management.md、project_layout.md。
- packages/store/docs/*.md：各 store 职责、接口、存储、谁可写。

---

## 二、尚未处理的内容（待办）

### 1. Phase 6 已收尾；可后续迭代
- **Proactive 逻辑**：已实现（见上文「Proactive」）。
- **端到端**：设计上满足「发消息→工具调用→记录仅写 store→流式回复→历史/导出导入」；无引用 src/、无解析写入。
- **管理端 UI**：在页面上可查看与编辑「文档」与「内容」的完整管理页（可后续迭代）；当前仅有简易对话页。
- **历史会话**：可选的历史会话列表与单会话查看（可后续迭代）；IPC 已支持 getSessions/getConversation/clearAll，前端未做列表与详情页。
- **docs/architecture.md**：已补充与现网关系、对话库与向量库在流程中的角色说明。

### 2. 向量与检索（可选增强）
- 每 5～10 轮用 LLM 生成对话摘要并向量化存入 type=dialogue_summary。
- 同一对话块生成意图/事实两段并分别 embed 存储与检索（多向量）。

### 3. 可选功能（未实现）
- 监控：token_usage、file_modifications（如 v1 monitor）。
- 自升级：满足条件时调用自升级流程并写日志。
- getActiveWindowTitle：获取当前窗口标题作为上下文（可选工具）。

### 4. 检查项（建议执行一次）
- 确认全仓库无 `require('../src/` 或 `require('../../src/`）等引用现网 src。
- 确认无 `updateUserIdentityFromMessage`、`appendRequirementToIdentity`、`isUserCorrection`、`recordCorrection`、从回复中解析【情感摘要】/【表达欲望】并写入的代码。

---

## 三、运行与后续开发

- **运行 v2**：`cd v2 && npm install && cp .env.example .env`（并配置 DEEPSEEK_API_KEY、OLLAMA_HOST 等），然后 `npm start`。
- **后续开发**：按 `docs/todo.md` 中未勾选项推进；Proactive 与管理页为优先可选项。
