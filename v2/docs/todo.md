# Aris v2 分阶段执行清单与待办

执行顺序：Phase 0 → 1 → 2 → 3 → 4 → 5 → 6。不得跳过未勾选项。

**Prompt 策略**：首轮完整 system；后续轮采用 **方案 A**（人设+规则+工具定义每轮保留，身份/要求/长记忆用简短摘要注入）。若后续改为方案 B，需更新 `server/dialogue/prompt.js` 及文档。

**记录机制短期**：身份累积+历史、要求对象列表+语义去重、关联索引+工具 已实现（见 `record_mechanism_improvement.md` 短期 1/2/3，schema 驱动）。

---

## 一、Phase 0～6 执行清单（历史与当前状态）

### Phase 0：v2 骨架与配置

- [x] 创建 v2/ 根目录及 package.json
- [x] 创建 v2/.env.example
- [x] 创建 packages/config/：index.js、paths.js（v2 数据目录、memory 目录）、constants.js
- [x] 创建 data/ 及 .gitkeep
- [x] 创建 README.md（v2 定位、与现网隔离、如何运行）
- [x] 创建 docs/project_layout.md

### Phase 1：Store 层（多文件 + 文档）

- [x] packages/store/package.json 与 index.js（统一导出）
- [x] store/identity.js：readIdentity、writeIdentity（已含累积+历史，schema 驱动）
- [x] store/requirements.js：appendRequirement、listRecent、getSummary（已含对象列表+语义去重，schema 驱动）
- [x] store/associations.js：addAssociation、getAssociationsFor（schema 驱动）
- [x] store/corrections.js、emotions.js、expressionDesires.js、conversations.js、state.js、vector.js
- [x] store/docs/*.md；docs/store.md

### Phase 2：向量与 Embedding

- [x] store/vector.js：embed、add、search、getRecentByType；前缀与时间衰减
- [x] 对话写入采用「结构化拼接块」
- [ ] 可选：每 5～10 轮摘要向量（type=dialogue_summary）；可选：意图/事实多向量
- [x] docs/vector_design.md

### Phase 3：Server 与对话

- [x] server/llm、dialogue/prompt、dialogue/tools（含 record_association、get_associations）、dialogue/handler
- [x] docs/prompt_strategy.md、docs/tools.md

### Phase 4：Electron 主进程与预加载

- [x] apps/electron：main、preload、config、backup；菜单导出/导入；IPC
- [x] v2 备份/恢复（SQLite + LanceDB）

### Phase 5：前端

- [x] apps/renderer：Vite + React + Tailwind；主对话页、流式展示、设置页（API Key、Ollama 说明）
- [ ] 设置/管理页：文档与内容管理（可后续迭代）
- [ ] 可选：历史会话列表与单会话查看
- [ ] 路由或 Tab：对话 | 设置/管理
- [x] docs/ui_management.md

### Phase 6：集成与收尾

- [x] 端到端对话、工具调用、记录仅写 store；Proactive 与低功耗
- [ ] 管理端：文档与内容在页面上可读写并持久化（可后续迭代）
- [x] 安静/恢复关键词可配置：shouldBeQuiet、isResumingDialogue 从 memory/quiet_phrases.json 读取，handler 与 proactive 共用 quietResume.js
- [ ] 可选：监控（token、文件修改）；自升级；getActiveWindowTitle
- [x] docs/architecture.md；无引用 src/、无解析写入

---

## 二、待办事项（按文档汇总）

以下来自 record_mechanism_improvement、vector_design、ui_management 等文档的未完成项，统一列供排期。

### 1. 前端 / 管理端

| 待办 | 来源 | 说明 |
|------|------|------|
| [ ] 设置/管理页：文档列表 | ui_management.md | 提供 docs/、store/docs/ 下 .md 列表，点开可查看与编辑，保存写回对应文件；仅允许约定目录，避免误改代码 |
| [ ] 设置/管理页：内容管理 | ui_management.md | 身份表单（姓名、备注）；用户要求列表（新增/编辑/删除）；纠错/情感/表达欲望列表（展示、删除、人工追加）；后端调对应 store |
| [ ] 路由或 Tab | todo Phase 5 | 对话 \| 设置/管理，便于进入管理页 |
| [ ] 历史会话列表与单会话查看 | — | IPC 已支持 getSessions、getConversation、clearAll，前端未做列表与详情页 |

### 2. 向量与检索（可选增强）

| 待办 | 来源 | 说明 |
|------|------|------|
| [ ] 每 5～10 轮对话摘要向量 | vector_design.md | 用 LLM 生成摘要，embed 存入 type=dialogue_summary，与 dialogue_turn 并存 |
| [ ] 意图/事实多向量 | vector_design.md | 同一对话块生成「意图」「事实」两段分别 embed（type: dialogue_intent, dialogue_fact），检索可双路或合并 |

### 3. 配置与去硬编码

| 待办 | 来源 | 说明 |
|------|------|------|
| [x] 安静/恢复关键词可配置 | todo Phase 6 | 已改为 memory/quiet_phrases.json（可编辑），quietResume.js 供 handler 与 proactive 共用 |

### 4. 可选功能

| 待办 | 来源 | 说明 |
|------|------|------|
| [ ] 监控 | — | token_usage、file_modifications（如 v1 monitor） |
| [ ] 自升级 | — | 满足条件时调用自升级流程并写日志 |
| [ ] getActiveWindowTitle | — | 获取当前窗口标题作为上下文（可选工具） |

### 5. 提示词优化（后续）

| 待办 | 来源 | 说明 |
|------|------|------|
| [ ] 提示词分层处理 | cache_memory_design 附录 A | 当前为单层一次性注入；后续可做「先注入基础层、再按需注入扩展层」或按角色/任务切换模板 |
| [ ] 意图先行再注入 | cache_memory_design 附录 A | 当前为每轮固定模板全量注入；后续可增加意图识别（规则或小模型），再根据意图决定注入哪些块、是否先查 action_cache 等 |

### 6. 缓存记忆（操作记录，见 cache_memory_design.md）

| 待办 | 来源 | 说明 |
|------|------|------|
| [ ] action_cache 持久化 + 文件修改标记 + 目录缓存 + 工具 | cache_memory_design | 实现 store/action_cache；read_file/write_file 后自动写缓存；file 类带 file_path、file_mtime_at_cache；list_my_files 后写入 dir 缓存（目录 mtime 校验）；write_file/delete_file 失效对应 file 与目录缓存。提供工具 get_read_file_cache/get_recent_read_file_cache/get_dir_cache，不把已读列表灌进 prompt |

### 7. 记录机制（中长期，见 record_mechanism_improvement.md）

| 待办 | 步骤 | 说明 |
|------|------|------|
| [ ] 中期 M1～M4 | 结构化存储 | knowledge_base.schema.json；knowledge_base.js（readEntity、writeEntity、addRelation、getRelations）；memory_files 配置；迁移脚本 migrate-to-knowledge-base.js |
| [ ] 中期 M5～M6 | 智能合并 | merge_policy.schema；写新信息时按策略查相似、解冲突、更新或新增 |
| [x] 长期 L1～L2 | 时间轴 | 已实现：store/timeline.js（appendEntry、getEntries）；identity/requirements/associations/corrections/emotions/expressionDesires/state/summaries/conversations 等写路径均追加时间线；数据目录下 timeline.json，支持按 since/until/type 查询。 |
| [ ] 长期 L3～L5 | 关联与自优化 | getSubgraph、getPaths；retrieval.schema 分层检索；使用统计与自适应策略 |

**记忆连贯性（ARIS_IDEAS + 计划）**：关联驱动检索（MVP）、小结沉淀（阶段 B）、分层记忆（阶段 A）、时间线（阶段 C）均已实现；配置见 retrieval_config.json。

### 8. 分发与打包

| 待办 | 来源 | 说明 |
|------|------|------|
| [ ] 向量/Ollama 方案落地后补充文档 | — | 确定方案后，在文档或新文档中补充：实现步骤、目录结构、打包配置示例、启动时检测与回退逻辑 |

### 9. 检查项（建议执行一次）

| 待办 | 来源 | 说明 |
|------|------|------|
| [x] 无引用现网 src | — | 已检查：v2 内无 require 引用 src/ |
| [x] 无解析写入 | — | 已检查：身份/要求/纠错/情感/表达仅经工具写入，无解析用户或助手文本后自动写入 |

---

## 三、优先级建议

- **优先可做**：管理端 UI（文档列表 + 内容管理）、历史会话列表、安静/恢复关键词可配置。
- **可选增强**：向量摘要与多向量、监控、自升级、getActiveWindowTitle；**缓存记忆（action_cache）** 按 cache_memory_design.md 实现。
- **后续优化**：提示词分层处理、意图先行再注入（见 cache_memory_design 附录 A）。
- **中长期**：记录机制 M1～L5 按 record_mechanism_improvement.md 分步迭代。
