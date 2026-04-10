# MemPalace vs Aris v3：记忆写入/分块/检索/注入链路对比（含中英文 token 密度影响）

更新时间：2026-04-09  
范围：仅基于已读到的 MemPalace 开源代码与 Aris v3 当前实现（`v3/serve/src`）的**代码证据**整理。  
目的：把“我们也有记忆检索/分块”这件事落到**具体实现与可解释差异**上，并指出哪些差异可能解释“体感效果差”。

---

## 结论摘要（高信号）

- **两边都是“全文（原文）+ 向量检索”的范式**：不是“只存向量”。差异主要在**写入单元（chunk 粒度）与检索门槛/注入策略**。
- **Aris v3 当前的向量写入单元不是语义 chunk**，而是每轮写入：
  - 用户消息（message）
  - 助手消息（message）
  - 用户+助手拼成的 turn（turn）
  这意味着“分块”更像“对话结构分块”，而不是“检索优化分块”。
- **MemPalace 的默认分块是固定长度 chunk（800 chars）+ overlap（100 chars）**，更接近典型 RAG chunking。
- **中文 vs 英文 token 密度会放大 chunk 粒度问题**：MemPalace 的 800 chars 在中文可能对应更高 token、更大语义块；Aris 的 message/turn 在中文也更容易“多主题混杂、向量平均化”，在你们有阈值的情况下更可能出现“检索为空/偏少”的断崖体验。

---

## 术语对齐

- **原文存储（verbatim storage）**：把可引用的原文片段（payload）存起来，检索命中后能直接回注 prompt 当证据。
- **向量存储（embedding index）**：把文本编码成向量，支持相似度检索（topK / ANN / cosine 等）。
- **“全文向量化” vs “全文存储 + 向量”**：
  - “全文向量化”如果仅存向量而不存 payload，会导致召回后缺证据文本，最终仍需回源拿原文。
  - MemPalace 与 Aris v3 都属于“全文存储 + 向量”，只是存储引擎不同。

---

## MemPalace：写入/分块/embedding/检索/注入（基于代码）

### A. 写入与分块（mine → chunk → drawer upsert）

- **入口**：`mempalace mine ...` 最终走 `mempalace/miner.py` 的 `mine()`。
- **分块策略**（字符级，不是 token 级）：
  - `CHUNK_SIZE = 800`（chars）
  - `CHUNK_OVERLAP = 100`（chars）
  - 优先按段落 `\n\n` / 换行 `\n` 尝试在 chunk 内寻找边界
  - `MIN_CHUNK_SIZE = 50`（太短不入库）
- **写入单位**：每个 chunk 作为一个 drawer：
  - `documents=[chunk_text]`
  - metadata：`wing`、`room`、`source_file`、`chunk_index`、`source_mtime` 等

### B. embedding（由 ChromaDB 负责）

- MemPalace 代码里使用 `chromadb.PersistentClient(...).get_collection(...)` / `create_collection(...)`，**未显式传入** `embedding_function=...`。
- 因此 embedding 模型与维度由 **ChromaDB 默认 embedding function**决定（依赖 Chroma 版本与运行环境）。

### C. 检索（semantic search + 可选 metadata filter）

- 典型查询：`col.query(query_texts=[query], n_results=k, include=["documents","metadatas","distances"], where=...)`
- `where` 支持 `wing/room` 过滤（属于标准 metadata filtering）。
- 默认就是取 topK，未看到类似 Aris 的 score_threshold 作为硬门槛（至少在其公开的 `searcher.py`/`layers.py` 路径中是这样）。

### D. prompt 注入思路（L0/L1/L2/L3）

- **L0**：用户手写 `~/.mempalace/identity.txt`（稳定、低 token）
- **L1**：从向量库抽“少量关键 drawer”（top-15），拼成“关键片段目录”（硬 cap）
  - `MAX_DRAWERS = 15`
  - `MAX_CHARS = 3200`
  - 每条 snippet 截断（约 200 chars）
- **L2**：按 wing/room 取少量 drawer（上限 N），每条 snippet 截断（约 300 chars）
- **L3**：全库语义检索返回 topK drawer

> 关键点：MemPalace 的“启动记忆”更像 Evidence shortlist（关键原文片段短名单），而不是叙事式摘要。

---

## Aris v3：写入/分块/embedding/检索/注入（基于代码）

### A. 写入单元（你们当前所谓“分块”= message/turn 粒度）

在 `v3/serve/src/app/chatService.ts` 的 `chat()` 与 `chat_stream()` 路径中，每轮都会生成 3 个 embedding 并 upsert：

- **message: userMsg.content**
- **message: assistantMsg.content**
- **turn: buildTurnText(user, assistant)**，格式固定：`用户：...\nAris：...`

metadata（落库时）包含：

- `conversation_id`
- `source_kind: 'message' | 'turn'`
- `source_text`（原文 payload，后续注入用）
- `source_created_at`

> 关键点：这不是“语义 chunking”。当消息很长或多主题时，embedding 会更像语义平均，召回更易偏。

### B. embedding（显式可控）

- embedding 由 `OpenAIEmbeddingClient` 走 OpenAI-兼容 embeddings API：
  - `model = ARIS_EMBED_MODEL`（默认 `nomic-embed-text`）
  - base_url 默认指向 `OLLAMA_HOST`
  - dimension 默认 `768`

### C. 向量存储与检索引擎

- **存储**：SQLite 表 `embeddings` 里存 `vector_json`（数组 JSON）与 `source_text` 等。
- **检索**：`LocalVectorStore.query()` 会加载全量向量到内存 Map，然后逐条 cosine 评分、筛选、排序。
  - 优点：实现简单、可控、易调试
  - 风险：规模大时线性扫描成本高；同时“候选集”与阈值策略对体验更敏感

### D. 检索策略（retrieveRelevantMemories）

在 `ChatService.retrieveRelevantMemories()`：

- 对用户当前输入 `queryText` 生成 query embedding
- 从 vectorStore 取候选：`queryVector` + `topK≈max((top_k_turn+top_k_message)*4,20)` + `score_threshold`
- 默认会排除当前会话（`exclude_current_conversation`）
- 支持时间衰减：`score * exp(-days * λ)`
- 去重：
  - 去掉重复文本
  - 去掉与当前会话最近 history 重复的文本
  - 支持 ignored topics（按包含子串过滤）
- 注入格式：每条截断到 280 chars，并带标签：
  - `[跨会话/对话片段|单条消息/score:0.xxx] <clipped text>`

### E. prompt 组装与“L0/L1 类内容”的对应关系

从你们的 `prompt.md`（运行时注入）来看，你们常驻上下文主要由这些块组成：

- **SYSTEM 人格/准则**：类似 MemPalace L0 的“身份/人格稳定信息”（但你们是模板注入，不是用户文件）
- `**aris:record_facts`**：结构化“已确认长期事实/偏好/纠错”清单（强事实层）
- `**aris:compaction**`：把早期对话压成“叙事式摘要”（生成时机受预算/长度触发）
- `**aris:tool_summaries**`：工具调用摘要（给模型自洽用）

对比 MemPalace 的 L1：

- MemPalace L1 是“关键原文片段短名单（evidence shortlist）+ 硬 cap”
- Aris 的 compaction 是“摘要文本（300–800 字）”，更连贯但更可能丢掉关键措辞；record_facts 更“结构化事实”，但不等价于“关键原话证据片段目录”

---

## 细节差距清单（可直接解释效果差的那种）

### 1) 写入单元（chunk 粒度）

- **MemPalace**：固定 chunk（800 chars）+ overlap（100）
- **Aris v3**：message/turn 粒度（每轮 2~3 条）

影响：

- message/turn 更容易“多主题混杂”，embedding 表征变平均，召回更随机
- fixed chunk 更容易形成“单主题片段”，topK 更稳（但中文场景下 800 chars 可能过大，需要重标定）

### 2) 检索门槛（threshold）

- **MemPalace**：默认 topK（未见 score_threshold 硬门槛）
- **Aris v3**：有 `score_threshold`（默认 0.45），并且还有排除当前会话、去重、忽略主题等过滤链路

影响：

- 过滤链路偏保守时，更可能出现“检索为空/偏少 → 模型只能靠当前上下文补全”的体验断崖

### 3) 注入内容形态（evidence vs summary）

- **MemPalace**：偏 evidence shortlist（原文片段列表）
- **Aris v3**：有 record_facts（强事实）+ compaction（摘要）+ retrieval_lines（片段，但来自 message/turn 单元且较短截断）

影响：

- “为什么当时这么决定”的问题更依赖原话证据；摘要可能把“why 的关键句”折叠掉

### 4) 引擎差异（Chroma vs SQLite+in-mem scan）

- **MemPalace**：Chroma 管 embedding/索引/检索
- **Aris v3**：embedding 可控，但检索是内存线性扫

影响：

- 规模变大时，Aris 可能更依赖阈值/候选数控制性能，进一步影响召回稳定性

---

## 中文 vs 英文 token 密度：对 chunk/阈值/topK 的系统性影响

### A. 为什么必须单独考虑中文

- MemPalace 的 chunk 参数是 **chars**，而 LLM 的上下文预算是 **tokens**。
- 英文：字符与 token 的比例通常更“稀”，800 chars 往往不是很大的一段。
- 中文：单字信息密度更高、token 往往更接近“字数级别”，同样 800 chars 可能是更大的语义块、更高 token 成本。

### B. 对 MemPalace 的含义

- 800 chars 在中文可能导致：
  - chunk 语义过大（多主题混杂）→ 召回精度下降
  - 注入成本更高（同样 topK 可能吃更多 token）
- 因此 MemPalace 的“英文/代码场景参数”不应直接照搬到中文语料，应改成 token-aware 或更小 chars 的 chunk。

### C. 对 Aris 的含义

- 你们的写入单元是 message/turn，中文长消息更常见时：
  - 单条 message/turn token 更大
  - 向量表征更平均
  - 结合 `score_threshold` 更容易“没有过线候选”
- 这解释了为什么在中文场景下，**阈值与 chunk 粒度**会比英文更敏感。

---

## 可借鉴逻辑（不引入“宫殿隐喻”的部分）

### MVP（最小改动、最可能立刻见效）

1. **检索兜底策略**：当 `score_threshold` 下召回为空/过少时，自动降阈值或改为 topK-only（同时记录 debug 指标，避免误伤）。
2. **从 message/turn 扩展到“轻量语义 chunk”**：先在写入侧做最小 chunking：
  - 以段落/换行/标点为边界切分
  - 设置 overlap
  - 将 chunk 作为额外 `source_kind: 'chunk'` 写入向量库（不替换原有 message/turn，先并存验证）

### 最终（结构化演进）

- **引入清晰的 L0/L1 层定义**（对齐 MemPalace 的“稳定身份层 + 关键证据目录层”）：
  - L0：稳定身份/项目背景/互动偏好（可考虑从 record_facts 生成，或拆成用户可编辑文件）
  - L1：从历史库中抽取“高价值证据片段列表”，硬 cap（token/条数双预算），用于启动与对齐
- **把 chunk 参数 token-aware**：中文场景用 token 预算驱动 chunk size 与注入条数，而不是 chars 定值。

---

## 附录：与 `prompt.md` 的映射（你们当前“已经有”的部分）

你们当前已经具备：

- “常驻人格/准则”system 层
- record_facts（身份/偏好/纠错）事实层
- compaction 摘要（OpenClaw 式：超预算/过长触发）
- retrieval_lines（向量召回片段，带分数与来源）
- ignored_topics / time_decay / exclude_current_conversation / 工具摘要

MemPalace 相对更“独特”的部分（从实现层面看）主要在：

- 写入单元默认就是 fixed chunk + overlap（更像检索系统的 chunking）
- L1 明确是 evidence shortlist + 硬 cap（而不是叙事摘要）
- 使用 Chroma 作为完整向量检索引擎（默认 embedding 由 Chroma 决定）

