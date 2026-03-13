# requirements.js

- **职责**：用户要求列表的追加、列表、摘要。
- **接口**：`appendRequirement(text)`、`listRecent(limit)`、`getSummary()`。
- **存储**：`memory/requirements.json`（数组）。
- **谁可写**：仅 `record_user_requirement` 工具或管理 API。
