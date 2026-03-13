# Aris v2 分阶段执行清单

执行顺序：Phase 0 → 1 → 2 → 3 → 4 → 5 → 6。不得跳过未勾选项。

**Prompt 策略**：首轮完整 system；后续轮采用 **方案 A**（人设+规则+工具定义每轮保留，身份/要求/长记忆用简短摘要注入）。若后续改为方案 B，需更新 `server/dialogue/prompt.js` 及 `docs/PROMPT-STRATEGY.md`。

---

## Phase 0：v2 骨架与配置

- [x] 创建 v2/ 根目录及 package.json
- [x] 创建 v2/.env.example
- [x] 创建 packages/config/：index.js、paths.js（v2 数据目录、memory 目录）、constants.js
- [x] 创建 data/ 及 .gitkeep
- [x] 创建 README.md（v2 定位、与现网隔离、如何运行）
- [x] 创建 docs/PROJECT-LAYOUT.md

---

## Phase 1：Store 层（多文件 + 文档）

- [x] packages/store/package.json 与 index.js（统一导出）
- [x] store/identity.js：readIdentity、writeIdentity
- [x] store/requirements.js：appendRequirement、listRecent、getSummary
- [x] store/corrections.js：appendCorrection、getRecent
- [x] store/emotions.js：appendEmotion、getRecent
- [x] store/expressionDesires.js：appendDesire、getRecent
- [x] store/conversations.js：封装 SQLite，append、getRecent、getCurrentSessionId；表结构与 v1 一致；数据目录使用 v2 独立路径
- [x] store/state.js：readState、writeState、readProactiveState、writeProactiveState
- [x] store/docs/*.md：每个 store 对应一篇（职责、接口、存储格式、谁可写）
- [x] docs/STORE.md：总览与对应关系表
- [x] 明确：对话库沿用 SQLite，仅路径与封装在 v2；向量数据只存向量库，不写入 .md

---

## Phase 2：向量与 Embedding（含 5 项优化）

- [x] store/vector.js：embed、add、search、getRecentByType；底层沿用 LanceDB，数据目录 v2 独立路径
- [x] 写入时对文档加 search_document: 前缀；检索时对 query 加 search_query:
- [x] 每条向量带 created_at；search 结果做时间衰减（0.7 相似度 + 0.3 时间因子），权重可配置
- [x] 对话写入采用「结构化拼接块」（在 handler 中拼块后调用 vector.add）
- [ ] 可选：每 5～10 轮摘要向量；可选：意图/事实多向量
- [x] docs/VECTOR-DESIGN.md：5 项优化、type 枚举、配置项
- [x] 明确：向量数据只存在向量数据库（LanceDB），不写入 .md

---

## Phase 3：Server 与对话

- [x] packages/server/package.json 与 index.js
- [x] server/llm/client.js、stream.js
- [x] server/dialogue/prompt.js：首轮完整、后续轮方案 A（人设+规则+工具每轮保留，身份/要求用简短摘要）
- [x] server/dialogue/tools/record.js：5 个记录工具，只调 store，结果塞回对话
- [x] server/dialogue/tools/file.js、memory.js、time.js
- [x] server/dialogue/tools/index.js：注册与分发
- [x] server/dialogue/handler.js：收消息→组 prompt→LLM（含 tool_calls）→执行工具→写 conversations + 写向量块→写 state；禁止从用户/助手文本解析身份/要求/纠错/情感/表达
- [x] docs/PROMPT-STRATEGY.md、docs/TOOLS.md

---

## Phase 4：Electron 主进程与预加载

- [x] apps/electron/package.json、main.js、preload.js、config.js
- [x] main 只加载 packages/server、config；创建主窗口、加载 renderer；不引用项目根 src/
- [x] 菜单：导出记忆数据库、导入记忆数据库（v2 备份/恢复，.aris = SQLite + LanceDB）
- [x] 定时器：startProactiveInterval，调用 server 侧 maybeProactiveMessage（Phase 6）
- [x] IPC：发送消息、流式回复、工具调用、会话列表/清空
- [x] 实现 v2 备份/恢复：exportToFile、importFromFile（SQLite + LanceDB），使用 v2 store

---

## Phase 5：前端（React + Tailwind + lucide，明亮风格）

- [x] apps/renderer 使用 Vite + React，配置 Tailwind、lucide-react（含简易 HTML 对话页）
- [x] 明亮主题，无 Three.js、无背景光环
- [x] 主对话页：输入、发送、消息列表、流式展示
- [ ] 设置/管理页：文档与内容管理（可后续迭代）
- [ ] 可选：历史会话列表与单会话查看
- [ ] 路由或 Tab：对话 | 设置/管理
- [x] docs/UI-MANAGEMENT.md

---

## Phase 6：集成与收尾

- [x] 端到端：启动 Electron → 对话收发、工具调用、记录类仅写 store
- [ ] 管理端：文档与内容在页面上可读写并持久化（可后续迭代）
- [x] Proactive 逻辑完整：状态、情感/表达欲望从 store 读，写回 state；低功耗/未回应计数
- [x] **Proactive 低功耗缺口**：当已在 low_power_mode 且最近用户消息「未恢复对话」时，proactive 应直接 return null，不再发主动消息（已在 proactive.js 中在恢复判断后增加 stateNow.low_power_mode 检查并 return null）
- [ ] **安静/恢复关键词去硬编码**：shouldBeQuiet、isResumingDialogue 当前为硬编码短语列表，建议改为配置文件或 store 可编辑列表，便于扩展与维护
- [ ] 可选：监控（token、文件修改）；可选：自升级；可选：getActiveWindowTitle
- [x] docs/ARCHITECTURE.md：架构图、数据流、与现网关系、对话库与向量库角色
- [x] 检查：无引用现有 src/；无正则/关键词解析写入身份/要求/纠错/情感/表达
- [x] 本 todo.md 与各 phase 保持同步
