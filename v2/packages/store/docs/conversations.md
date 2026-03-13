# conversations.js

- **职责**：会话与消息的持久化（对话流水）。
- **接口**：`append(sessionId, role, content)`、`getRecent(sessionId, limit)`、`getCurrentSessionId()`。
- **存储**：SQLite，表与 v1 一致（settings, conversations），数据目录为 v2 独立路径。
- **谁可写**：由 handler 每轮结束后调用，不经过工具。
