# identity.js

- **职责**：用户身份（姓名、备注）的读写。
- **接口**：`readIdentity()` → `{ name, notes }`；`writeIdentity({ name?, notes? })`。
- **存储**：`memory/identity.json`（路径由 config 提供）。
- **谁可写**：仅 `record_user_identity` 工具或管理 API 调用；不做任何从对话文本的解析。
