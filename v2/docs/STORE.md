# v2 Store 层总览

## 职责与对应关系

| 模块 | 文件 | 接口示例 | 持久化 | 谁可写 |
|------|------|----------|--------|--------|
| 用户身份 | identity.js | readIdentity, writeIdentity | memory/identity.json | 仅 record_user_identity 工具或管理 API |
| 用户要求 | requirements.js | appendRequirement, listRecent, getSummary | memory/requirements.json | 仅 record_user_requirement 或管理 API |
| 纠错 | corrections.js | appendCorrection, getRecent | memory/corrections.json 或向量 type=correction | 仅 record_correction 或管理 API |
| 情感 | emotions.js | appendEmotion, getRecent | memory/emotions.json 或向量 | 仅 record_emotion 或管理 API |
| 表达欲望 | expressionDesires.js | appendDesire, getRecent | memory/expression_desires.json 或向量 | 仅 record_expression_desire 或管理 API |
| 对话历史 | conversations.js | append, getRecent, getCurrentSessionId | SQLite（表同 v1） | handler 每轮 |
| 向量/检索 | vector.js | embed, add, search, getRecentByType | LanceDB | handler、工具、可选 store 内调用 |
| 运行状态 | state.js | readState, writeState, readProactiveState, writeProactiveState | aris_state.json, aris_proactive_state.json | handler、proactive |

## 说明

- 对话库与向量库与 v1 一致（SQLite + LanceDB），仅数据目录使用 v2 独立路径。
- 向量数据只存在向量数据库，不写入 .md；.md 仅作文档（store/docs/*.md）。
