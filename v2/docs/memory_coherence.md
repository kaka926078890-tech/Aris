# 记忆连贯性：架构与配置

本文档记录「记忆的连贯性」相关实现（ARIS_IDEAS + 记忆连贯性 MVP 与完成计划），便于后续维护与扩展。

## 目标对齐

- 把过去的对话、经历**自然地联系起来** → 关联驱动 + 分层
- 形成**更完整的理解**，而不是碎片化 → 小结沉淀
- 记忆**像日记一样累积** → 用好关联与小结
- **基于过去推理和联想** → 分层过滤 + 时间线回溯

## 已实现模块

| 模块 | 说明 | 配置/入口 |
|------|------|-----------|
| **关联驱动检索（MVP）** | 组 prompt 时拉取与当前身份、当前要求相关的关联，压成 1～3 行注入 system【相关关联】 | retrieval_config.json：enable_association_inject、max_association_lines、source_types、requirement_id_max |
| **小结沉淀（阶段 B）** | 每 N 轮用 LLM 生成会话小结，写入 session_summaries.json；prompt 中注入【近期小结】 | retrieval_config.json：enable_summary、summary_rounds_interval；store/summaries.js |
| **分层记忆（阶段 A）** | 向量写入时打 related_entities 标签；search_memories 仅返回与当前身份/要求相关的经历 | retrieval_config.json：filter_experience_by_association、max_experience_results；vector.search(options.filterByEntities) |
| **时间线（阶段 C / L1～L2）** | 所有 write 路径在写入时向 timeline 追加一条记录；支持按时刻、类型查询 | data/timeline.json；store/timeline.js：appendEntry、getEntries({ since, until, type, limit }) |

## 配置项一览（retrieval_config.json）

- **关联注入**：enable_association_inject、max_association_lines、source_types、requirement_id_max  
- **小结**：enable_summary、summary_rounds_interval  
- **分层**：filter_experience_by_association、max_experience_results  

详见 v2/README.md「可配置项一览」。

## 时间线类型（timeline 写入的 type）

- identity、requirement、association、correction、emotion、expression_desire、state、proactive_state、session_summary、conversation  

读取时可用 `getEntries({ type: 'identity', limit: 20 })` 等按类型过滤，或按 since/until 做时间范围查询。

**当前使用场景**：时间线仅写入、未在对话/管理页中直接展示；可用于排查问题（查看 data/timeline.json 或调用 getEntries）、或为后续「修改历史」「某时刻状态回溯」等功能提供数据基础。侧栏若有「时间线/历史」入口，可指向本能力或会话历史，由前端按需对接 getEntries 或会话列表。
