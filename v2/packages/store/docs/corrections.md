# corrections.js

- **职责**：纠错记录的追加与按条数查询。
- **接口**：`appendCorrection(previous, correction)`、`getRecent(limit)`。
- **存储**：`memory/corrections.json` 或向量 type=correction。
- **谁可写**：仅 `record_correction` 工具或管理 API。
