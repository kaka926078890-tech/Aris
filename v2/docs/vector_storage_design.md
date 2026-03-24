# 向量化数据存储设计（讨论稿）

本文档明确 **v3 向量数据库服务层应存储哪些内容**，供实现与评审用。当前为讨论稿，定稿后作为 vector-service 与 BFF 的约定。

---

## 〇、时间存储约定

- **统一使用 Unix 时间戳（毫秒）**：所有「时间」字段（如 created_at、last_viewed_at、date 等）在**存储与 API 请求/响应**中一律使用 **number** 类型的毫秒时间戳（如 `1700000000000`），**不使用 ISO 8601 字符串**。
- **原因**：避免时区与解析歧义；前端或各层如需展示「本地时间」由展示侧用 `new Date(ts).toLocaleString()` 等自行转换，存储与传输层无时差问题。
- 下文所有 metadata 中的 created_at、date、last_viewed_at 等均按此约定。

---

## 一、v2 现状（对照）

v2 中**实际写入向量库**的只有两类：

| type | 写入时机 | 文本内容 | metadata |
|------|----------|----------|----------|
| **dialogue_turn** | 每轮对话结束后 | 最近 1 轮「User + Assistant」拼成一块 | session_id, related_entities（当前身份 + 最近若干 requirement id） |
| **aris_behavior** | 主动消息发送后 | 「Aris 主动: …」或「Aris 主动（积累表达）: …」 | 可选 session_id 等 |

- **检索（v2 实现）**：默认 **向量 ANN + MiniSearch 全文混合** → **Top-K 余弦重排** → 时间衰减；`ARIS_MEMORY_HYBRID=false` 回退纯向量。见 `v2/.env.example`、README「向量记忆检索」。
- **不入向量的**：identity、requirements、preferences、corrections、emotions、expression_desires 等仅存 JSON，search_memories 只能搜到对话块与 aris_behavior；write_file 写入的文件（如自产报告）也未做摘要入向量。

---

## 二、v3 建议：写入向量的内容范围

### 2.1 必存（与 v2 对齐，保证检索能力）

| type | 说明 | 文本内容建议 | metadata 建议 |
|------|------|--------------|----------------|
| **dialogue_turn** | 每轮对话结束后由 BFF 调用向量层 add | 最近 N 轮（建议 N=1～2）User+Assistant 拼成一块，与 v2 一致 | session_id, related_entities（数组，用于分层过滤） |
| **aris_behavior** | 主动消息（含「积累表达」）发送后 | 「Aris 主动: …」或「Aris 主动（积累表达）: …」 | 可选 session_id, created_at（ts） |

- **related_entities**：与 v2 一致，由 BFF 根据当前 identity + 最近若干 requirement id 生成，用于 search 时的 filter（分层记忆）；向量层只按 metadata 过滤，不解释业务含义。

### 2.2 可选扩展（按需在 v3 或后续迭代）

| type | 说明 | 写入时机 | 文本内容建议 | metadata 建议 |
|------|------|----------|--------------|----------------|
| **dialogue_summary** | 会话小结的向量化 | 每 N 轮生成小结后，BFF 将小结文本 embed 后 add | 小结正文（2～4 句） | session_id, round_index, created_at（ts） |
| **user_requirement** | 用户要求/偏好的可检索副本 | record_user_requirement 或 record_preference 成功后，由 BFF 调向量层 add | 单条 requirement 或 preference 的 summary 文本 | requirement_id 或 preference_id，可选 related_entities, created_at（ts） |
| **correction** | 纠错的可检索副本 | record_correction 成功后 | 「用户纠正：previous → correction」类短句 | 可选 created_at（ts） |
| **emotion** | 情感记录的可检索副本 | record_emotion 成功后 | 情感 text | 可选 intensity, created_at（ts） |
| **file_summary** | 文件（如 aris_ideas.md）的摘要或段落 | write_file 写入指定路径后，BFF 或异步任务做摘要/分块后 add | 段落或摘要文本 | path, source: "file" |

- **取舍建议**：  
  - **MVP**：只做必存（dialogue_turn + aris_behavior），与 v2 行为一致，实现简单、检索语义与 v2 一致。  
  - **后续**：若希望「用户说过喜欢 X」也能被 search_memories 搜到，可加 user_requirement；若希望「某文档里写过什么」可被语义搜到，可加 file_summary；dialogue_summary 可减少对话块数量、提升长会话检索质量。

### 2.3 Aris 行为与操作记忆（扩展讨论）

以下场景：**Aris 访问过某文档/某段代码、制定了计划、写了文档、拷贝了文件**，以及**是否需要对 Aris 的操作做总结并记录**，统一在此讨论并给出建议类型与写入时机。

#### 2.3.1 文档/代码「看过」的记忆与 Aris 认识图谱（提高 read_file 利用率）

- **场景**：Aris 通过 read_file 访问过某个文档或项目里某段代码；后续被问「你之前看过什么」「有没有看过和 X 相关的文档」时应能回忆；**更重要的是**：若 Aris 昨天已经看过了整个项目的文档路径，应形成**自己的认识图谱/路径记忆**，在**代码未更新**的情况下**不需要反复调用 read_file 重读同一路径**，而是优先基于已有记忆回答，提高工具利用率。
- **是否需要记录**：**建议记录**，且需支持「已读过 + 是否仍最新」的判断，避免无效重读。
- **建议 type**：**document_view**（或 file_access）。
- **写入时机**：read_file 成功返回某 path 的内容后，由 BFF 调向量层 add 一条；同时建议在**数据层**维护「路径视图索引」（见下），便于快速判断某 path 自上次阅读后是否变更。
- **文本内容建议**：  
  - 采用**方案 B（可检索内容）**：在 text 中写入「path + 内容摘要或首段」（或按块入多条），便于「Aris 曾看过关于 Y 的内容」的语义检索，也便于在「不再次 read_file」时直接复用该条作为对某 path 的认知。  
  - 轻量方案 A 仅「path + 时间」不利于「不重读就回忆内容」，不推荐作为唯一存储。
- **metadata 建议**（时间均用**毫秒时间戳**）：  
  - **path**（string）、**session_id**、**created_at**（number, ms）；  
  - **content_hash** 或 **file_mtime**（number, ms）：由数据层在 read_file 时提供当前文件的内容哈希或修改时间；用于后续判断「该 path 自上次阅读后是否被修改」。若未改，则无需再次 read_file，可直接使用已有 document_view 的 text 或从数据层缓存返回。
- **认识图谱 / 路径索引（数据层或 BFF）**：  
  - 建议在**数据层**维护一张「Aris 已读路径」索引，例如：`path -> { last_viewed_at (ts), content_hash_or_mtime, summary_text_or_doc_id }`。  
  - read_file 成功时：写入向量层 document_view（path + 摘要/首段 + metadata）；更新该 path 的 last_viewed_at、content_hash_or_mtime、可选 summary 或指向向量条目的 id。  
  - **工具/API**：提供 **get_paths_aris_has_seen**（或 get_document_views）：返回「Aris 已读过的 path 列表 + 每条的上次阅读时间戳 + 当前文件是否已变更」。  
  - **模型侧**：在需要某 path 内容时，先调用 **get_paths_aris_has_seen**（或 search_memories 限定 type=document_view + path）；若该 path 已存在且「当前文件 mtime/hash 与上次一致」，则**不再调用 read_file**，而是使用已有 document_view 的 text 或数据层缓存的摘要；仅当 path 未读过或文件已变更时才调用 read_file。  
- **与 file_summary 区别**：file_summary 是「文件里写了什么」（写时做摘要）；document_view 是「Aris 在何时读过什么 + 当时内容快照」，侧重访问行为与可复用认知。二者可并存。

#### 2.3.2 「今天制定了一个计划」如何记住

- **场景**：用户在对话里和 Aris 一起定了计划，或 Aris 把计划写进了 aris_ideas.md 等；后续希望「Aris 还记得我们定的计划吗」「查一下之前的计划」能命中。
- **如何记住**：  
  1. **已在对话里**：dialogue_turn 会包含「用户说定计划 + Aris 回复的计划内容」，search_memories 能搜到对话块，即已能记住；  
  2. **写在文档里**：若计划写在 memory/aris_ideas.md 等，通过 **file_summary**（写文件后对该文档做摘要/分块入向量）即可被语义检索；  
  3. **显式「计划」类型（可选）**：若希望「计划」在检索时更突出、或需要单独展示「我的计划列表」，可增加 type **plan**：在 BFF 侧当 Aris 调用 write_file 写入约定路径（如 aris_ideas 的「行动计划」小节）或新工具 record_plan 时，将该段文本或摘要 add 为 type=plan，metadata 可带 plan_id、path、created_at。
- **建议**：MVP 可依赖 dialogue_turn + file_summary；若产品上需要「计划」为一等公民，再加 plan 类型与对应写入路径。

#### 2.3.3 「今天写了一个文档、拷贝了一个文件」如何记住

- **场景**：Aris 执行了 write_file、或未来有 copy_file 等操作；需要记住「Aris 做过什么」，便于「你今天都做了什么」「有没有改过 X 文件」等检索。
- **建议**：  
  1. **操作本身**：用 type **operation**（或 aris_activity）记录「做了什么」，便于按行为检索。  
     - 写入时机：write_file / copy_file（及后续其他写操作）成功后，BFF 调向量层 add 一条。  
     - 文本内容建议：短句描述，如「Aris 写入了文档 memory/xxx.md」「Aris 将 pathA 拷贝到 pathB」。  
     - metadata：operation_type（如 "write_file" / "copy_file"）, path 或 source_path/target_path, session_id, created_at。  
  2. **文档内容**：若希望「写的文档里讲了什么」也能被语义搜到，**另外**对该文档做 **file_summary**（见 2.2）；即「操作一条（做了什么）+ 内容一条（写了什么）」。  
- **总结**：写文档 = 一条 operation（做了写操作）+ 可选一条或若干 file_summary（文档内容摘要）；拷贝文件 = 一条 operation 即可，除非需要对目标文件内容做摘要。

#### 2.3.4 Aris 的操作是否需要「总结」并记录

- **场景**：希望有「今天 Aris 都做了什么」的概括，例如「今天 Aris 看了 X 文档、制定了 Y 计划、写了 Z 文档」，便于用户一问即得或做日报/周报。
- **是否需要**：**建议支持**。单条 operation / document_view / dialogue_turn 已有，但「一段时间的汇总」对「我/ Aris 最近在忙什么」很有用。
- **实现方式建议**：  
  1. **按日/按会话的摘要入向量**：新增 type **aris_activity_summary**（或 daily_summary）。  
     - 写入时机：由 BFF 的定时任务或会话结束时触发，汇总「当日/当会话」的 document_view、operation、以及可选 dialogue_turn 中的关键动作，用 LLM 生成一句或几句总结（如「今日 Aris 阅读了 X、写入了 Y、与用户讨论了 Z」），再 embed 后 add。  
     - 文本内容：即该段总结。  
     - metadata：date（毫秒时间戳，表示日期当天 0 点或会话边界）或 session_id, summary_scope: "day" | "session"。  
  2. **检索**：用户问「今天 Aris 做了什么」时，search_memories 可命中这类 summary；若需要「仅查总结」可在 search 时加 filter type=aris_activity_summary。
- **可选**：若不做自动总结，也可仅依赖「多条 operation + document_view + dialogue_turn」由模型在检索结果上自行归纳；自动总结则体验更稳定、回答更简洁。

---

将上述扩展类型汇总进「可选扩展」表，便于与 2.2 一致落地：

| type | 说明 | 写入时机 | 文本内容建议 | metadata 建议 |
|------|------|----------|--------------|----------------|
| **document_view** | Aris 读过某文档/某段代码；支持认识图谱、未变更则不重读 | read_file 成功返回某 path 后 | path + 内容摘要/首段（便于复用、不反复 read_file） | path, session_id, created_at（ts）, content_hash 或 file_mtime（ts） |
| **plan** | 显式计划（可选一等公民） | write_file 到计划路径或 record_plan 时 | 计划正文或摘要 | plan_id, path, created_at（ts） |
| **operation** | Aris 的写/拷贝等操作 | write_file、copy_file 等成功后 | 短句如「Aris 写入了 path」「Aris 将 A 拷贝到 B」 | operation_type, path(s), session_id, created_at（ts） |
| **aris_activity_summary** | 某日/某会话的操作总结 | 定时或会话结束时 LLM 汇总后写入 | 一句或几句总结 | date（ts）或 session_id, summary_scope |

### 2.4 明确不写入向量的（仍仅存数据层）

- 原始对话流水：仅数据层（SQLite/PostgreSQL），不整库入向量。  
- identity（姓名、备注）：仅数据层，按需 get_user_identity。  
- 配置类 JSON（quiet_phrases、retrieval_config、config 等）：仅数据层。  
- 原始文件内容：仅数据层或文件存储；若要做语义检索，用 file_summary 等**派生**入向量，不在向量层存整文件。

---

## 三、单条向量记录的通用字段约定

便于向量层与 BFF 统一，建议每条记录包含：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| text | string | 是 | 用于 embed 的原文，也是检索结果返回的展示内容 |
| vector | number[] | 是 | 由向量层 embed 生成或调用方传入（若 BFF 自调 embed 再 add 则可由 BFF 传入） |
| type | string | 是 | 枚举：dialogue_turn, aris_behavior, dialogue_summary, user_requirement, correction, emotion, file_summary, document_view, plan, operation, aris_activity_summary 等 |
| metadata | object | 否 | session_id, related_entities, path, created_at（仅时间戳）等，供过滤与展示 |
| created_at | number | 建议 | **必用毫秒时间戳**，用于时间衰减与排序；禁止 ISO 字符串，避免时差歧义 |

- **embed 前缀**：与 v2 一致，存时文本前加 `search_document:`，检索时 query 前加 `search_query:`（可由向量层统一加，或由 BFF 在调用 embed 前加）。

---

## 四、检索行为（向量层职责）

- **search**：入参 query、limit、可选 filter（如 metadata.related_entities 与某列表有交集）。  
- 向量层：对 query 做 embed（加 search_query: 前缀），按向量相似度检索，再按 filter 过滤 metadata，再按时间衰减融合得分（与 v2 一致：相似度×0.7 + 时间×0.3），返回 top-k 的 text、score、created_at（**时间戳**）、metadata。  
- **谁算 filter**：related_entities 等由 BFF 根据当前身份与 requirement 列表计算，传给向量层；向量层只做「metadata 满足条件则保留」，不解析业务。

---

## 五、待定项（讨论后定稿）

**基础与 2.2 可选扩展**  
1. **dialogue_turn 的 N**：v2 为 1 轮；v3 是否保持 1 或改为 2（更多上下文、略增存储）。  
2. **是否在 MVP 就加 user_requirement / correction / emotion 的向量副本**：加则 search_memories 能搜到「用户说过喜欢/纠正过/情感」，但写入路径增多，需在 BFF 的 record_* 回调里调向量层 add。  
3. **file_summary**：是否在 write_file 后自动对指定路径（如 memory/aris_ideas.md）做摘要或分块入向量；若做，摘要由 BFF 调 LLM 还是简单截断。  
4. **dialogue_summary**：是否在 v3 阶段就写入向量（v2 有小结但未入向量，只注入 prompt）。

**Aris 行为与操作记忆（2.3）**  
5. **document_view**：已建议写入 path + 内容摘要/首段，并配合数据层「路径视图索引」+ content_hash/file_mtime，实现「未更新则不重读」；是否在 MVP 提供 get_paths_aris_has_seen 工具及数据层索引表。  
6. **plan**：是否单独设 plan 类型及写入路径（如 aris_ideas 计划小节 / record_plan），还是 MVP 仅依赖 dialogue_turn + file_summary。  
7. **operation**：是否在 write_file / copy_file 等成功后写入 operation 类型；若做，operation_type 枚举范围（如 write_file, copy_file, delete_file）。  
8. **aris_activity_summary**：是否做按日或按会话的「Aris 操作总结」并入向量；若做，触发频率（每日一次 / 会话结束）与生成方式（LLM 汇总 vs 仅靠检索后模型归纳）。

请按需在上表与待定项上标注结论，定稿后更新本文档并同步到 implementation_plan 与 vector-service 实现。
