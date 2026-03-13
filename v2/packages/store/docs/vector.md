# vector.js

- **职责**：embedding 与向量库读写；LanceDB 封装，含 5 项优化（拼接块、摘要、query/doc 前缀、时间衰减、可选多向量）。
- **接口**：`embed(text, options?)`、`add({ text, vector, type, metadata })`、`search(queryVector, options)`、`getRecentByType(type, limit)`。
- **存储**：LanceDB，数据目录为 v2 独立路径。向量数据只存此处，不写入 .md。
