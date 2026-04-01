# Aris v3：提示词、记忆与工具层 — 最终方案规格

> 本文档供实现与评审使用：按章节可直接拆任务动工。范围仅限 **v3 最小后端**（`v3/serve`）的**陪伴型对话**取向；不包含代码助手、Shell 替代专用工具、子代理 Fork 等与产品无关的能力。

---

## 1. 目标与原则

1. **人格与裁量在 persona / 对话结构**：引擎层提示词只做**边界、协议、可验证性**，用短句说明；不把「闲聊/非闲聊」等大词表策略写进 system（与仓库内 `aris-character-and-engine.mdc`、`prompt-and-tools-design.mdc` 一致）。
2. **记忆能关、能检索、能过期**：长期事实与「仅本会话有用」的信息分层；模型**不得**把对话流水当永久档案。
3. **注入内容语义清晰**：避免模型把**压缩摘要、检索片段、时间锚点**误绑到「用户当前这一句」上。
4. **可验证优先**：涉及时间顺序、复盘、总结时，以 `get_timeline` / 工具证据为准；记忆文本为**快照**，可能与当下陈述冲突。

---

## 2. 运行时注入上下文协议（最终）

### 2.1 统一前言（必选）

在**所有其它由服务端组装的 system 块之前**（persona / 模板之后亦可，但须全站一致），增加一段**固定短文**（建议 3～6 行），明确约定：

| 约定项 | 含义 |
|--------|------|
| 多段 system | 除用户可见设定外，下列标题各段的 system 内容为**运行时注入**，用于补全上下文。 |
| 与当前用户句的关系 | 这些内容**不一定**与用户**本轮**输入一一对应；**优先以用户当前自然语言为准**。 |
| 冲突处理 | 若注入中的事实与用户**刚说的内容**矛盾，以**当前话**为准，并应考虑通过工具更新或废弃过时记录。 |

目的：对齐「系统提醒与所在消息无直接绑定」类问题，降低把 compaction 摘要误当「正在讨论的话题」的概率。  
实现位置：`PromptBuilder.build()` 中在首条业务 system 之前插入，或合并为 `policy.system_template` 的固定后缀（二选一，全项目统一）。

### 2.2 注入块标识（推荐）

为日志、调试与未来前端过滤预留**机器可读边界**（可选，不展示给最终用户）：

- 建议在每类注入内容首尾使用 HTML 注释风格占位，例如：`<!-- aris:compaction -->` … `<!-- /aris:compaction -->`（若模型服务商对注释有清洗，可改为单行前缀 `[ARIS_INJECT:compaction]`）。
- 类型枚举建议：`compaction`、`record_facts`、`retrieval`、`history_time_hints`、`tool_policy`、`engine_preamble`。

同一类型多块时带序号或由代码保证仅一块。

### 2.3 各块现有文案强化（在最终方案中一并改写）

- **Compaction 摘要**（已有「当前句优先」）：补充一句——**摘要可能遗漏细节**；若用户追问精确原话或先后顺序，**必须**再调用 `get_timeline` 或 `search_memories` 取证，不得仅凭摘要断言。
- **长期记忆列表**（`record_lines`）：在块首说明中增加 **陈旧性**（见第 6 节）的短规则。
- **检索记忆**（`retrieval_lines`）：强调 **可能来自其它会话**、**仅相关时引用**；引用时避免当成用户刚说过的话复述成「你刚才说」。

---

## 3. 长对话、Compaction 与工具结果可见性（最终）

### 3.1 与实现对齐的事实

- 消息全量在 SQLite；进窗历史受 token budget 与 `recent_turns` 等约束。
- **Compaction**：较早轮次压成持久摘要，尾部 K 条保留原文；摘要进入 `PromptBuilder` 的 `compaction_summary`。
- **Session pruning**：较早轮的 `metadata.tool_trace` 可按配置不重复注入；细节不可再依赖「仍在 messages 数组里」。

### 3.2 模型侧纪律（写入 system / `buildToolPolicyMessage`）

1. **多轮工具后**，若在**最终对用户的回复**里仍要依赖某一工具结果中的关键事实，应在**自然语言回复中显式写出该要点**（人话一句即可），勿假设后续轮次仍能读到完整 tool 原文。
2. **Compaction 之后**，用户追问「你之前工具里说的那个数/那句话」时，应 **再次调用** `get_record` / `search_memories` / `get_timeline` 等恢复证据，禁止凭模糊印象编造。

### 3.3 工程侧可选增强（最终方案完整性）

- **工具结果摘要落库**（按会话或按 message_id 关联）：仅保留「本轮可引用事实」短文本（例如 500 字内），供超长会话二次注入或专用工具读取；与 `events` / `timeline` 分工明确（timeline 偏审计与顺序，摘要偏语义要点）。
- 配置项（落地时同步 `v3/serve/.env.example` 与 `v2/README.md` 中 v3 指向说明）：如 `ARIS_TOOL_SUMMARY_ENABLED`、`ARIS_TOOL_SUMMARY_MAX_CHARS`。

---

## 4. 长期记忆分类与数据模型（最终）

在现有 `identity`（settings）、`preferences`、`corrections` 之上，采用**显式分类**，便于检索排序、过期策略与提示词分工（概念上对齐「user / feedback / project / reference」，映射如下）。

### 4.1 分类定义

| 分类键 | 含义 | 写入时机（模型侧规则） |
|--------|------|------------------------|
| `user_profile` | 用户是谁、如何称呼、稳定背景（职业/作息等用户愿意说的） | 用户明确提供或长期重复且确认无误时 |
| `interaction_feedback` | 对 **Aris 互动方式** 的纠正与**肯定**（「别这样」「就这样很好」） | 纠正即时写；对非常规但有效的互动，**主动**简记（避免只记失败导致过度保守） |
| `preference` | 喜好、厌恶、稳定习惯（现有 preference） | 用户表达稳定偏好时 |
| `correction` | 事实纠错（现有 correction） | 用户指出说错时 |
| `project_context` | **进行中**约定：截止、当前阶段、双方口头约定的小目标 | 状态变化快；需 **updated_at** 与可选 **expires_at** 或「仅本会话」标记 |
| `reference_pointer` | 外部信息源习惯：常用链接、「详情在 XX App」 | 用户说明可查之处时；**禁止编造 URL** |

### 4.2 库表与存储（建议迁移）

1. **`preferences` 表扩展**（或新建统一 `memory_entries` 表二选一；以下为扩表现有表以少动读路径的示例）  
   - `memory_kind`：`enum` / `TEXT CHECK`，取值含 `preference`、`interaction_feedback`、`project_context`、`reference_pointer`（`user_profile` 可继续主要走 identity JSON，或并入 settings 旁路）。  
   - `summary`：保持一行摘要；**必填** `description`（一行检索用，与 Claude 文档中 frontmatter `description` 同作用）。  
   - `why_context`：`TEXT NULL`，用户给出的理由或场景（对应 **Why:**）。  
   - `how_to_apply`：`TEXT NULL`，边界说明（对应 **How to apply:**）。  
   - `updated_at`：`TEXT ISO8601`；写入新版本时更新；旧条可 `superseded_by_id` 或软删。  
   - `expires_at`：`TEXT NULL`，主要用于 `project_context`。

2. **`corrections`**  
   - 增加 `why_context` 可选；`created_at` 已有则用于陈旧性排序。

3. **Identity（settings `identity_json`）**  
   - JSON 内增加 `updated_at`（可选）；规则上仍属 `user_profile`。

4. **索引**  
   - `(memory_kind, updated_at DESC)` 供列表与注入排序。  
   - 全文/向量若挂在 embeddings 上，需在 metadata 中写入 `memory_kind` 以便过滤。

### 4.3 与工具 `record` 的映射

- `record` 的 `type` 或 `payload` 扩展为支持上述 `memory_kind`（保持旧枚举兼容：旧客户端仍写 `preference` → 默认 kind=`preference`）。  
- **工具 description** 中写清：每类必填字段（至少 `description` 一行 + 正文摘要）；`project_context` 必须把用户口中的相对时间（如「下周四」）解析为**绝对日期**写入 `summary` 或 `why_context`。

### 4.4 注入策略（PromptBuilder / chatService）

- **进固定注入块的**：仅 **高置信、短、稳定** 的子集（如 identity + 最近 N 条 preference/correction + 最多 M 条 `project_context` 未过期项）。  
- **`interaction_feedback`、`reference_pointer`、长文 project**：默认 **不进固定 system**，由 `search_memories` / `get_record` 按需取（符合「能工具则工具」）。

---

## 5. 禁止写入长期记忆的内容（最终）

以下内容**不得**通过 `record` 写入长期存储（工具层 description 与 system 双写）：

1. **当前会话的临时进度**（「我们刚说到第几步」）——用对话本身 + 可选「会话意图」存储（第 7 节）。  
2. **整段聊天流水**——已有 transcript 与向量。  
3. **可从工具即时再取的事实**（除非用户明确要求「记住这个数」类）。  
4. **重复条目**：写入前应用层或模型应先 `get_record` / `search_memories` 查近似主题，**更新**优于**新建**。

---

## 6. 陈旧性、冲突与用户「忽略/忘记」（最终）

### 6.1 System 与工具文案中的硬规则

1. 长期记忆是**某时刻快照**，可能与用户当前状态不一致。  
2. **在仅依据记忆给用户生活/事实类建议前**，若话题敏感或时效强，应结合**当前句**核对；冲突时 **以当前话为准**，并提示可更新记忆。  
3. 用户明确表示「忘掉 X」「别提 Y」：后续轮次**不引用**该类记忆；实现上可用标签 `user_ignored_topics` 存 settings 或由用户编辑数据（产品路径另定），模型侧需遵守「当作未存储」。

### 6.2 检索排序

- `search_memories` 与向量召回：最终排序加入 **`updated_at` 衰减**（配置化系数，与 v2 `memory_row_time_decay` 思想一致），避免十年前偏好压过昨天纠正。

---

## 7. 会话意图与长期记忆分离（最终）

**问题**：多步约定、本周计划等若写入 `preferences` 会污染长期画像。  

**方案**（二选一，推荐 A）：

- **A. `conversation` 级短生命周期状态**  
  - 新表 `conversation_context`：`conversation_id`、`intent_json`（或纯文本 `session_note`）、`updated_at`、`ttl` 或依赖 compaction 时由摘要吸收后清空。  
  - Compaction 执行时：将 `session_note` **合并进 compaction 摘要**后删除或归档，避免与 `record` 混源。

- **B. 仅 events**  
  - 用现有 `events` 类型 `session_intent_update` 追加；读取时用专用工具 `get_session_intent` 拉最近一条。  
  - 缺点：合并与展示逻辑略散，长期仍建议迁 A。

**模型规则**：「本周我们要做完的三件事」→ 写入会话上下文；「我一直不喜欢香菜」→ `record` preference。

---

## 8. 工具调用策略（最终）

在现有 `buildToolPolicyMessage()` 七条基础上扩展为完整策略说明（保持简短列表，每条一行）：

1. **并行**：互不依赖的只读调用（如 `get_current_time` + `get_record`）**同一轮可并行**（依赖 LLM/API 是否支持 multi-tool_calls；若不支持则由实现串行但提示中仍写「允许一次请求多个」以利未来兼容）。  
2. **读写顺序**：同一轮内若既读又写长期记忆，**先读后写**，避免覆盖未读到的旧状态。  
3. **取证优先级**：「先后顺序 / 复盘 / 摘要对话」→ **先** `get_timeline`（或按产品再加证据工具），再叙述；无证据处必须标明不确定。  
4. **记录正负反馈**：对互动方式的纠正与明确肯定，走 `interaction_feedback`（或等价 type），且尽量带 **Why**。  
5. **URL**：任何对外链的引用须来自用户消息或工具返回的明确字段；**禁止编造链接**（若 v3 后续接入网页抓取，在工具 policy 中单列一条）。

实现时合并重复段落：`chatService` 内两处 `buildToolPolicyMessage` 应抽为单一方法或共享常量，避免漂移。

---

## 9. 人格与输出（最终）

不照搬「效率至上、结论先行」的助手文风；仅吸收以下**反机械**约束，写入 `DEFAULT_PERSONA` 或独立「输出边界」短段（2～4 行）：

- 避免**大段复述用户原话**作开场。  
- 避免**空话铺垫**；情绪类场景仍允许先承接，但不用固定三段式模板。  
- 信息类问题可相对简练；**不**强制全局「先结论后共情」。

---

## 10. 实现检查清单（动工顺序建议）

1. **PromptBuilder**：注入统一前言；各块标题与注释边界；改写 compaction / record / retrieval 块说明。（已实现）  
2. **chatService**：`toolPolicy.ts` 单源工具纪律；与第 3.2 节一致。（已实现）  
3. **数据库迁移**：`007_memory_kinds_session_context` — `preferences` 扩展、`corrections.why_context`、`conversation_context`。（已实现）  
4. **recordRepo / ChatTools**：`record`/`get_record` 支持 `memory_kind`、`session_context`；`list_preferences_for_prompt` 按第 4.4 节过滤。（已实现）  
5. **search_memories / 向量**：`VectorMeta.source_created_at` + `PROMPT_RETRIEVAL_TIME_DECAY_PER_DAY`。（已实现；embeddings 未单独存 kind，仍为对话向量）  
6. **Compaction**：合并 `conversation_context.session_note` 进摘要后 `clearSessionNote`。（已实现）  
7. **文档与配置**：`.env.example`、`v3/serve/README.md`。（已同步）  

**未做 / 后续**：工具结果摘要落库（§3.3）、`superseded_by_id` 写入链路、用户「忘掉 X」的 settings 实现（§6.1）。
（已全部实现：`tool_summaries` 表 + prompt 回注入；`add_preference` 自动 supersede；`user_ignored_topics_json` + `ignore_topics` 工具与检索/注入过滤。）

---

## 11. 本文档维护

- 若实现与本文冲突，**以代码为准**后应回头改本文档。  
- 新增可配置项须同步 `v3/serve/.env.example` 与上层 README 中 v3 说明（遵守仓库「配置参数须同步文档」规则）。

---

## 12. 参考（外部启发源）

- 思路来自对 Claude Code 仓库「记忆与工具 / 系统提示」结构的剥离：仅保留与**对话产品**通用的协议层，去掉工程任务、Bash、子代理代码探索等无关段落。
