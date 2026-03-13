# expressionDesires.js

- **职责**：表达欲望记录的追加与查询。
- **接口**：`appendDesire({ text, intensity? })`、`getRecent(limit)`。
- **存储**：`memory/expression_desires.json` 或向量 type=aris_expression_desire。
- **谁可写**：仅 `record_expression_desire` 工具或管理 API。
