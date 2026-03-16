# v2 向量设计（5 项优化）

## 1. 结构化拼接（Contextual Chunking）

- 不按单句存向量。每轮写入时，将「上一轮 User+Assistant + 本轮 User+Assistant」拼成一块再 embed 写入，type 如 `dialogue_turn`。
- 效果：检索时上下文完整，例如搜「天气」能带到「上海」等前文。

## 2. 对话摘要（Summarization-as-Embedding）

- 每 5～10 轮用 LLM 生成对话摘要，仅将摘要 embed 存入，type 为 `dialogue_summary`。
- 可选实现；与 dialogue_turn 并存。

## 3. Query / Document 前缀（nomic-embed-text）

- 存储时：文本前加 `search_document:`。
- 检索时：用户问题前加 `search_query:`。
- 在 vector.js 的 add/search 或调用处统一处理。

## 4. 时间权重衰减（Temporal Weighting）

- 检索结果带 `created_at`。最终得分 = 向量相似度 × 0.7 + 时间衰减因子 × 0.3，再重排。
- 权重可配置（如 constants.js）。

## 5. 多向量（可选）

- 同一对话块可额外生成「意图」「事实」两段并分别 embed 存储（type: dialogue_intent, dialogue_fact），检索时可双路或合并。

## type 枚举（示例）

- dialogue_turn：对话块
- dialogue_summary：周期摘要
- dialogue_intent / dialogue_fact：可选
- correction, aris_emotion, aris_expression_desire, user_requirement：若需语义检索可写入向量

## 数据存放

- 向量数据只存在 **LanceDB**（向量库），不写入 .md 或 JSON 文件。
