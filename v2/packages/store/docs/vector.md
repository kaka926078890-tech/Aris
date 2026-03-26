# vector.js

- **职责**：embedding 与向量库读写；LanceDB 封装；混合召回、第二阶段 **RRF + 字面覆盖**（`memoryRerankStage2.js`）；query/doc 前缀（`constants.js`）。
- **接口**：`embed(text, options?)`、`add({ text, vector, type, metadata })`、`search(queryText, limit, options)`、`getRecentByType(type, limit)`。
- **存储**：LanceDB，数据目录为 v2 独立路径。向量数据只存此处，不写入 .md。

## 排序阶段（默认）

1. 向量 ANN + MiniSearch 并集 → 混合分 + 池内余弦融合（与 `ARIS_RERANK_*`、`ARIS_HYBRID_*` 相关）。
2. **第二阶段**（`ARIS_MEMORY_FINAL_STAGE2` 非 false）：对池内每条算 **RRF**（向量 / BM25 / 余弦 三列排名）与 **查询字面覆盖**，再与混合余弦残差加权融合。
3. 乘 `ARIS_VECTOR_SIMILARITY_WEIGHT` / `ARIS_VECTOR_TIME_WEIGHT`（**默认时间权重 0**）。

回退：`ARIS_MEMORY_FINAL_STAGE2=false` 时使用旧「混合余弦 + 时间」；`ARIS_MEMORY_HYBRID=false` 时纯向量路径。
