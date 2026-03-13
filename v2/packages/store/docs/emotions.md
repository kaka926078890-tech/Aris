# emotions.js

- **职责**：情感记录的追加与查询。
- **接口**：`appendEmotion({ text, intensity?, tags? })`、`getRecent(limit)`。
- **存储**：`memory/emotions.json` 或向量 type=aris_emotion。
- **谁可写**：仅 `record_emotion` 工具或管理 API。
