# 体验优化：具体改动计划（可执行版）

> 基于 [`ux_feedback_and_optimization.md`](ux_feedback_and_optimization.md) 拆成 **阶段、改动点、同步/异步边界、依赖文件**。  
> 标 **「需你决定」** 的条目涉及产品取舍，实现前请确认。

---

## 已落实（截至当前）

| 项 | 状态 |
|----|------|
| **P0** | 已实现：数据目录写入 **`dialogue_turn_metrics.jsonl`**（默认开启），环境变量 **`ARIS_DIALOGUE_METRICS_LOG=false`** 可关闭。字段含：`planner_ms`、`planner_enabled`、`system_chars`、`tool_rounds` / `tool_rounds_detail`、`file_tool_calls`、`embed_ms`、`total_turn_ms`、token 用量、`had_tool_calls`。实现见 `dialogueMetrics.js`、`handler.js`。 |
| **P1 文件类工具上限** | 已实现：**单条用户消息**触发的工具循环内，**文件类工具最多 10 次**（`list_my_files`、`get_*_cache`、`read_file`、`write_file`、`delete_file`、`get_my_context`）。超限返回错误文案，不执行工具。常量见 `packages/config/constants.js`（`FILE_TOOL_MAX_PER_USER_TURN`、`isFileToolName`）。 |
| **P1.1 文件缓存短路** | 已实现：`read_file` 在 mtime 命中时可返回缓存摘要（`force_full: true` 读全文）；`list_my_files` 返回 `from_cache`。见 `action_cache.js`、`file.js`。 |
| **P2 Planner** | **策略已落实**：默认 **A**；省延迟用 **B（显式关）**；**不实现** C（闲聊跳过）。无新增代码，见 § 四「推荐策略」。 |
| **P3 异步 record** | 已实现：`emotion`、`expression_desire`、`self_note` 默认 **`setImmediate` 后台写入**，`ARIS_RECORD_ASYNC=false` 可改回同步。 |
| **P4 风格稳定** | 已实现：`ARIS_CHAT_TEMPERATURE`（默认 **0.62**），`llm/temperature.js` + `client.js` / `stream.js`；`v2/rules.md` 增加语气一致性短规则。 |
| **P5 记忆检索** | 已实现 MVP：`search_memories` 在向量分数上叠加 **keywordOverlapBoost**（字面重叠）；移除 `shouldRetrieveMemory` 末尾 **随机**检索。完整 BM25/混合检索仍为可选演进。 |
| **P6 仓库搜索** | 已实现：工具 **`search_repo_text`**（`tools/repo_search.js`），优先 **rg**，失败则 Node 有限扫描；计入文件类工具 **10 次**配额。 |
| **工具循环上限** | 已实现：**`ARIS_MAX_TOOL_ROUNDS`**（默认 **25**，原 100）。 |

### 说明：P3 / P4 与「需你拍板」的关系

早期文稿里 **P3（异步 record）**、**P4（temperature / 规则）** 写在 **「需你决定」** 下，是避免替产品做主。后来你要求 **「一次解决 P2–P6」**，实现时在 **未再单独开一轮确认** 的前提下，采用了下面 **可回退的默认**（与文档 § 五、§ 六 的建议大体一致，但范围略宽）：

| 项 | 当时文稿 | 实际落地（仍可由你改） |
|----|----------|-------------------------|
| **P3** | 建议起步仅 `emotion` 异步 | **`emotion`、`expression_desire`、`self_note`** 默认异步；**`ARIS_RECORD_ASYNC=false`** 可全部改回同步。 |
| **P4** | 略降 temperature、需 A/B | 默认 **`ARIS_CHAT_TEMPERATURE=0.62`**；**`v2/rules.md`** 增加短「语气一致性」段（非 memory 覆盖时的基线）。 |

若你希望 **严格按「只拍板过的才生效」** 的流程：以后可约定 **先确认默认再合代码**；当前若不满意，直接改 env / `rules.md` / 或提出要把异步范围 **收窄为仅 emotion**，我可以再改一版实现。

---

## 十一、产品问答（为何曾提「默认关 Planner」、工具轮是否重复带完整提示词）

### 为何「优化文档」里曾写「默认关闭 Planner」？

- 那只是 **可选策略**（`ARIS_PROMPT_PLANNER_ENABLED=false`）：**关掉**可省 **主对话前多一次 DeepSeek 请求**，对延迟敏感的用户有用。  
- **代价**是 system 会回到 **LEGACY**：全文约束 + 三场景全开，**token 更大**、可能更慢。  
- **当前默认仍是开启 Planner**（未改默认行为）；是否默认关，取决于你更在意 **首包延迟** 还是 **省 token / 注入精细度**。

### 工具循环里，是否每一轮都把「要求、纠错、对话」等整包塞进 API？

- **是的**。当前实现里，`messages` 的第一条始终是 **同一条完整 `system`**（人设、约束摘要/全文、近窗对话、小结等，视 Planner 而定）；之后每一轮工具只是在后面追加 `assistant`（含 `tool_calls`）与 `tool` 结果。  
- **原因**：Chat Completions 协议下，模型需要 **同一轮内** 的完整上下文才能在 **下一步** 决定继续用哪个工具、如何综合用户情绪与代码事实；**没有**「只带 read_file 的精简 system」的第二条通道。  
- **因此**：读文件、列目录时，**仍会**带上「用户约束、对话摘要」等 —— 这是 **有意设计**（避免模型「读代码时忘记用户刚说的情绪」），代价是 **prompt 更长、多轮工具时重复计费**。若要优化，属于 **大改**：例如拆成「仅工具子代理」或「第二轮起用精简 system」（需仔细设计一致性，**尚未实现**）。

---

## 十二、待考虑：工具轮精简 system / 双上下文（延后）

| 项 | 说明 |
|----|------|
| **目标** | 在「仅探路读代码」等场景减少重复注入约束与长对话，降 token / 延迟。 |
| **体量** | **中大型**：需改 `handler` 消息构造、与 `buildPromptContext` 的契约，并处理「精简后仍要记住用户情绪」的一致性策略；**非**改几句提示词可完成。 |
| **状态** | **暂不实施**，仅作 roadmap；待 P0 指标证明「重复 system 计费」是主矛盾后再立项。 |

---

## 〇、总览：什么能异步、什么必须同步

| 类型 | 建议 | 原因 |
|------|------|------|
| **用户可见的回复文本** | **必须同步** | 用户等待的就是这条；除非做「先占位后补全」（复杂度高）。 |
| **Prompt Planner** | **当前同步**；可选 **规则跳过** 或 **异步仅用于下轮** | Planner 结果决定本回合 system；异步不能改本回合注入，除非接受默认 plan。 |
| **主对话 `chatWithTools` 多轮** | **同步** | 模型依赖上一轮 tool 结果；不能异步乱序。 |
| **向量写入（对话块 embed + LanceDB add）** | **已是「回复返回后」在 handler 里执行**；失败只打日志 | 可保持；若要再「彻底不阻塞主进程」，可改为 `setImmediate`/队列（通常收益小）。 |
| **会话小结 `maybeGenerateSummary`** | **已异步**（`setImmediate`） | 无需改模式。 |
| **constraints_brief 重建** | 部分路径 **await**（无摘要时） | 若觉慢，可单独优化为「先截断、后台再压 brief」（需你接受首轮 brief 可能为截断）。 |
| **`record` 写入磁盘/JSON** | **当前同步**（工具返回 `ok` 依赖写成功） | 若 **emotion / expression_desire** 等改为异步：工具可立即 `ok: true, pending: true`，后台写入；**下一轮 `get_record` 可能尚未可见**（需你接受）。 |
| **文件读缓存命中** | **应在 `read_file` / `list_my_files` 内部同步查缓存** | 不改变工具语义，只加速；返回里带 `from_cache`。 |

---

## 一、阶段划分与优先级

| 阶段 | 目标 | 大致风险 |
|------|------|----------|
| **P0 观测** | 分清「慢在 Planner / 工具轮次 / API / Ollama」 | 低 |
| **P1 文件与工具预算** | 缓解问题 1（重复探路）；缓存不依赖模型自觉 | 低～中 |
| **P2 Planner 策略** | 缓解问题 2（首包多一次 API） | 中（**需你决定**） |
| **P3 记录异步化（可选）** | 缓解问题 2（record 串在关键路径） | 中（**需你决定**） |
| **P4 风格稳定** | 缓解问题 3 | 低（**需你决定**语气是否接受略「收」） |
| **P5 记忆检索** | 缓解问题 4 | 中～高（工程量大时可再拆） |
| **P6 批量文件搜索工具** | 进一步缓解问题 1 | 中 |

建议顺序：**P0 → P1 →（拍板 P2）→（拍板 P3）→ P4 → P5 → P6**，其中 P5/P6 可并行设计。

---

## 二、P0：观测（建议先做）✅ 已实现

**目的**：用数据验证瓶颈，避免盲改。落地情况见上文 **「已落实」**。

| 改动项 | 做法 | 主要文件 |
|--------|------|----------|
| 计时 Planner | `runPromptPlanner` 前后 `performance.now()`，打一条 log 或写入 `prompt_planner_metrics.jsonl` 扩展字段 | `promptPlanner.js`、`handler.js`（若 metrics 在 handler 汇总） |
| 计工具轮次与名称 | 每轮 `chatWithTools` 记录 `round`、是否有 `tool_calls`、工具名列表 | `handler.js` |
| 可选：首 token 时间 | 若未来主路径改流式，再记；当前工具轮非流式，可先记「用户发送到最终回复开始」近似为整轮耗时 | `handler.js` / `main.js` IPC 层 |
| Ollama 健康 | `embed` 失败时已有 warn；可加「本回合 embed 耗时」 | `vector.js`、`handler.js` 后处理段 |

**异步性**：纯日志，**全同步**，无产品语义变化。

**需你决定**：是否允许在数据目录多写一个 **`dialogue_turn_metrics.jsonl`**（或合并进现有 metrics），以及是否仅在 `ARIS_*_LOG=true` 时启用（避免磁盘涨太快）。

---

## 三、P1：文件缓存短路 + 工具预算

### 3.1 `read_file` / `list_my_files` 内部先查 `action_cache` ✅

| 改动项 | 做法 |
|--------|------|
| `read_file` | 读盘前查 **单文件** 有效缓存（`getSingleFileReadIfValid`）：mtime 一致则 **直接返回摘要** + `from_cache: true`；需全文时传 **`force_full: true`** 跳过缓存并走磁盘（仍受 `READ_FILE_MAX_CHARS` 限制）。 |
| `list_my_files` | 目录 mtime 命中时返回缓存列表（原有逻辑），并带 **`from_cache`** 字段。 |

**主要文件**：`packages/server/dialogue/tools/file.js`、`packages/store/action_cache.js`。

**异步性**：**同步**，仅减少磁盘与模型重复劳动。

**风险**：摘要截断导致模型看不到最新全文 —— 已有 mtime 校验则可接受；需在返回中明确 `from_cache` 与「摘要截断」提示（现有 summarize 逻辑可沿用）。

### 3.2 工具轮 / 探索深度上限

| 改动项 | 做法 |
|--------|------|
| 全局 `MAX_TOOL_ROUNDS` | 当前 `handler.js` 已有 `MAX_TOOL_ROUNDS = 100`；改为 **配置化**（如 `behavior_config.json` 或 env），**默认降到 15～25**（**需你决定** 具体数字）。 |
| 文件类工具子计数 | 可选：`list_my_files` + `read_file` 合计超过 **N 次**（同一会话或同一用户消息）则后续工具返回 `ok: false, error: '...请直接指定路径'`。 |

**主要文件**：`handler.js`（传 `toolContext` 计数）、`file.js`（或统一在 `runTool` 包装层）。

**异步性**：同步拦截。

**需你决定**：**硬上限数值**（例如单条用户消息最多 12 次文件工具）；是否对 **非文件工具**（如 `search_memories`）单独配额。

---

## 四、P2：Prompt Planner 策略（缓解首包 +1 API）

### 产品原则（与 `.cursor/rules/aris-character-and-engine.mdc` 一致）

- **人格与裁量** 优先体现在主对话、记忆与工具；**不**为省一次 API 而默认引入「闲聊/非闲聊」词表判决。
- **默认**：继续 **每轮由编排 LLM（Planner）决定注入**（方案 **A**），保证场景块与约束开关一致。
- **延迟优先的用户**：用 **显式配置** 关闭 Planner（方案 **B**），接受更大 system —— **不**改仓库默认值，由用户在设置或 `ARIS_PROMPT_PLANNER_ENABLED=false` / `behavior_config` 中自选。
- **方案 C**（启发式跳过 Planner）：**不作为当前默认实现**；若未来 `dialogue_turn_metrics` 证明 Planner 是主瓶颈且产品接受误判风险，再单独立项；须 **保守默认、可一键关闭、词表配置化**，见下表。

以下 **互斥或组合**，按投入从低到高排列。

| 方案 | 做法 | 优点 | 代价 |
|------|------|------|------|
| **A. 保持现状（当前默认）** | 每轮先跑 Planner | 注入一致、无词表误判 | 每轮 +1 DeepSeek |
| **B. 用户显式关 Planner** | `ARIS_PROMPT_PLANNER_ENABLED=false` 或 `prompt_planner_enabled: false` | 立刻省一轮 | system 变大（LEGACY），token 升 |
| **C. 规则粗判「纯闲聊」（可选、未默认）** | 启发式跳过 Planner → `DEFAULT_PLAN` | 省部分轮次 | 可能少注入场景块；**不**在无指标时实施 |
| **D. 合并 Planner 进主模型** | 单请求先 JSON 再答 — **工程量大** | 省一次 RTT | 解析 fragile、提示词复杂 |

### 推荐策略（已收录）

- **默认**：**A** — 保留每轮 Planner，保证注入一致。  
- **急省延迟**：**B** — 仅在设置或环境中 **显式** 关闭 Planner；**不**把「默认关」写进仓库。  
- **C**：仅当 `dialogue_turn_metrics` 等指标证明 Planner 是主瓶颈、且产品接受误判风险时，再单独立项；**当前不实现**。  
- **D**：远期再评估（解析与维护成本高）。

#### P2 方案 C：「闲聊」怎么判断？是不是只能硬编码？

**不是只能写死在代码里**，但 **MVP 一定是规则/词表**，便于调参与发版；可分层：

| 层级 | 典型做法 | 说明 |
|------|----------|------|
| **1. 结构** | 消息长度 ≤ N 字、无多行、无 URL/路径形态 |  cheap，误判少碰长文需求 |
| **2. 强信号 → 必须跑 Planner** | 出现代码/工程/记忆相关触发词或子串：`/`、`memory/`、`.js`、`read_file`、`search_memories`、重启、bug、文件路径等 | 宁可多跑 Planner，少漏场景 |
| **3. 弱信号 → 倾向闲聊** | 纯问候、短句、表情为主（可维护 **可配置词表**，如 `memory/planner_skip_hints.json`，勿写死在 `if` 里一堆中文） | 与 `quiet_phrases` 类似，由你维护列表 |
| **4. 会话上下文（可选）** | 上一轮若刚调过文件/记忆工具，本句即短也 **不跳过** Planner | 减少「上一句还在改代码、这句接一句嗯」误判 |

**实现落点**：新建 `plannerHeuristic.js`（或挂在 `behavior_config.json` 字段），在 `buildPromptContext` 里 **先于** `runPromptPlanner` 判断：`shouldSkipPlanner(userMessage, recentMeta) === true` → 使用 `DEFAULT_PLAN` 并记日志（含 `skip_reason`），便于用 `dialogue_turn_metrics` 对账。

**误判后果**：跳过 Planner 时场景规则块可能变少；主对话仍可通过 **工具** 进入代码/记忆路径，但 **提示层面的场景说明** 可能弱一档。缓解：**强信号表** 保守一点；或 **仅当 DEFAULT_PLAN 与 CONSERVATIVE 之间取「中间 plan」**（例如只注入 `code_operation` 当消息含 `packages`）— 二期。

**异步性**：B/C 均为 **同步分支**，不引入异步 Planner；**不要**把 Planner 放后台还指望本回合生效（除非接受本回合用默认 plan）。

**主要文件**：`handler.js` + `buildPromptContext`、`promptPlanner.js`（若做 C）、新建 `plannerHeuristic.js`（推荐）。

**当前处理方式**：维持 **A** 为默认；**B** 仅通过用户/环境 **显式** 关闭；**C** 不开发，直至有指标与单独立项。

**若未来立项 C 时再需决定**：**N 字阈值**、强/弱信号词表路径、是否「上一轮有工具则不跳过」。

---

## 五、P3：`record` 异步化（可选）✅ 已按默认落地（见上文「说明：P3 / P4 与拍板」）

**仅当** P0 证明 `record` 在热点路径里占比高时再上。

| 类型 | 建议 | 理由 |
|------|------|------|
| **identity / requirement / correction** | **保持同步** | 用户明确说「记住」时期望下一轮立即生效；纠错链不能丢。 |
| **emotion / expression_desire** | **可异步** | 多为主观感受，**可接受** 写入延迟 100ms～1s；下轮 `get_record` 可能略滞后。 |
| **preference / association** | **建议同步**（或仅 preference 异步） | 关联与喜好常影响后续检索与 proactive；异步需更多一致性设计。 |
| **self_note** | 可异步 | Aris 自用笔记，延迟敏感度低。 |

**实现要点**：

1. `runRecordTool` 对选定 type：`setImmediate`/`queueMicrotask` 内执行原写入，立即 `return { ok: true, message: '已记下（后台写入）', async: true }`。  
2. 失败时写 **timeline 或日志**，可选 **下次启动时重试**（复杂，可二期）。  
3. **facade / timeline** 若依赖同步顺序，需检查。

**主要文件**：`packages/server/dialogue/tools/record.js`、各 store 的 `append*`。

**已选默认（可改）**：异步 type 为 **`emotion`、`expression_desire`、`self_note`**；关闭方式 **`ARIS_RECORD_ASYNC=false`**。若你只想要 **`emotion` 异步**，需再改代码收窄范围。

**仍属产品取舍**：

1. 是否 **UI 提示**「已记下」（当前仅在 tool 返回文案中带「后台写入」）。  
2. 是否接受 **极少数** 崩溃前未落盘（与当前同步写入相比风险略增，二期可做 WAL）。

---

## 六、P4：风格稳定（问题 3）✅ 已按默认落地（见上文「说明：P3 / P4 与拍板」）

| 改动项 | 做法 | 主要文件 |
|--------|------|----------|
| 主对话 temperature | 略降（如 0.7 → 0.55），**需 A/B** | `client.js` / `stream.js` 中默认值 |
| Planner 已低温度 | 保持 | `promptPlanner.js` |
| persona / rules | 增加 **短约束**：如「同一会话内语气档位一致、避免忽文言忽口语」 | `persona.md`、`rules.md` 或 `memory/conversation_rules.md` |
| 减少 system 抖动 | 稳定 `need_full_constraints` 触发条件（Planner 侧提示语微调） | `promptPlanner.js` |

**异步性**：无；均为同步提示词与参数。

**已选默认**：**`ARIS_CHAT_TEMPERATURE`**（默认 **0.62**）；可调高恢复活泼度。**设置页切换「稳定/活泼」档位** 仍未做（需 UI），仅 env。

---

## 七、P5：记忆检索效率（问题 4）

| 改动项 | 阶段 | 说明 |
|--------|------|------|
| **默认 limit 下调** | MVP | `search_memories` 默认 `limit` 从 5 再评估（或保持 5，但加强 `generateSmartQuery` 减少无效召回） | `memory.js` |
| **混合稀疏检索** | 中期 | Node 侧 BM25/FTS + 向量 RRF，见前文 memory 方案 | `vector.js`、新模块 |
| **提示词：减少无效 search** | MVP | 在 `conversation_rules` 或工具 description 中强调：闲聊不搜、点名回忆再搜 | `prompt.js` / 工具描述 |

**异步性**：检索本身 **同步**；若未来「预检索」可放在 Planner 前 —— 会与 P2 抢时序，**不建议**首轮就上。

**需你决定**：P5 与 P2 的优先级（若 Planner 已占大量时间，先 P2 再 P5）。

---

## 八、P6：批量/搜索类文件工具（问题 1）

| 改动项 | 做法 | 依赖 |
|--------|------|------|
| `grep_repo` / `search_files` | 对 v2 根目录执行 **ripgrep**（`child_process`）或纯 Node 遍历 + 限制文件数/扩展名 | 需注意二进制排除、超时、结果截断 |
| 或 `glob_files` | `fast-glob` 等列出匹配路径，减少多次 `list` | npm 依赖 |

**主要文件**：新 `tools/repo_search.js`（示例名）、`tools/index.js` 注册。

**异步性**：`exec` 为异步 API，但在 **单轮工具内 await**，对用户仍是「一轮工具一步」。

**需你决定**：是否允许增加 **原生二进制依赖**（rg）还是纯 Node（慢一些但可移植）。

---

## 九、执行清单（Checklist）

- [x] **P0**：`dialogue_turn_metrics.jsonl`（默认写入）；`ARIS_DIALOGUE_METRICS_LOG=false` 关闭  
- [x] **P1.1**：`read_file` / `list_my_files` 内部缓存短路（`force_full` 可选）  
- [x] **P1.2**：文件类工具上限 **10** / 回合  
- [x] **P2**：策略默认 **A** / 显式 **B**；**不实现 C**（见 § 四）  
- [x] **P3**：`emotion` / `expression_desire` / `self_note` 默认异步；`ARIS_RECORD_ASYNC=false` 关闭  
- [x] **P4**：`ARIS_CHAT_TEMPERATURE` + `v2/rules.md`  
- [x] **P5**：字面重叠加权 + 去掉随机检索；**完整混合检索**仍可选  
- [x] **P6**：`search_repo_text`（rg + 回退）  
- [x] **工具轮上限**：`ARIS_MAX_TOOL_ROUNDS` 默认 25

---

## 十、关联文档

- [`ux_feedback_and_optimization.md`](ux_feedback_and_optimization.md) — 问题与根因  
- [`agent_architecture_overview.md`](agent_architecture_overview.md) — 当前架构  
- [`prompt_packaging.md`](prompt_packaging.md) — Planner 与注入  

---

*版本：初稿；实施时请在 PR 或本文件勾选 checklist 并补充实际 env / 配置键名。*
