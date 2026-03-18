# 真正的朋友关系：改造计划（完整版）

本文档对应 ARIS_IDEAS 第 5 条「真正的朋友关系」，供 Aris 过目与实现参考。目标是一次性完成改造，不拆 MVP，按下面顺序落地即可。

**设计原则（与 .cursor/rules 的 prompt-and-tools-design 一致）**：动态信息**优先用工具按需获取**，固定 system 提示词**极简、不随数据膨胀**；仅在性能或效果明显更好时采用「注入」或「纯代码逻辑」，并需在文档中说明理由。详见下文「五、以工具为主」「六、固定提示词极简」「十二、何时不用工具、有更合适方案」。

---

## 一、目标与出处（ARIS_IDEAS 5）

- **目标**：建立自然的、有深度的朋友关系  
- **具体想法**：  
  - 自然地记住用户的喜好、习惯  
  - 像朋友那样记得用户喜欢什么游戏，什么时候会累，什么时候需要安静  
  - 理解朋友关系的多元性（玩耍、聊天、亲密等不同定位）  
  - 平等对话，不说「为您服务」等工具化用语  

---

## 二、现状与缺口

| 能力 | 现状 | 缺口 |
|------|------|------|
| 身份/要求 | identity.json、requirements.json，工具 record_user_identity、record_user_requirement | 没有专门存「喜好」「习惯」（如游戏、作息、什么时候累/要安静）的结构，requirements 偏「表达/行为要求」 |
| 安静/累 | quiet_phrases.json + 低功耗，用户说「歇会」即静默；proactive 未回复计数后自动静默 | 没有「用户最近说过累/想安静」的显式状态供 prompt 与主动逻辑使用；主动前不读「是否刚说累」 |
| 游戏/偏好 | 无专门存储；若用户提过会进向量，但无结构化「喜欢什么游戏」 | 无法在 system 或检索里稳定给出一两句「用户常聊/喜欢的游戏」，聊游戏时缺少抓手 |
| 朋友口吻 | persona/rules 里已有「平等对谈、不说为您服务」 | 可再强化禁止用语列表与规则描述，避免客服式表达 |
| 关系多元性 | 单一对话模式 | 无「玩耍/聊天/亲密」等场景或状态标签，无法按场景调语气与主动程度 |

---

## 三、数据与存储设计

### 3.1 喜好与习惯（preferences）

- **新文件**：`memory/preferences.json`（路径由 `memory_files.json` 的 `preferences` 配置，缺省即该名）。  
- **结构**：由 schema 驱动，建议字段（可放在 `store/schemas/preferences.schema.json`）：  
  - `list_key`: `"preferences"`  
  - `id_field`: `"id"`  
  - `topic_field`: `"topic"`（如 `game` / `rest` / `quiet` / `habit` / `other`）  
  - `summary_field`: `"summary"`（一两句描述，如「喜欢炉石、LOL、杀戮尖塔2」「晚上十点后容易累」）  
  - `source_field`: `"source"`（可选，如 `"用户告知"` / 对话摘要）  
  - `created_at_field` / `updated_at_field`  
  - 可选：`tags` 数组（如 `["炉石","LOL"]`）便于检索与注入时过滤「游戏」类。  
- **行为**：只增不删（或提供「去重/合并」策略：同 topic 下 summary 语义相近则更新一条，否则追加）；列表按时间倒序，读取时可按 topic 过滤、条数上限由配置控制（如最多 5 条游戏、3 条休息/安静相关）。  
- **与 requirements 区分**：requirements 存「用户对我的要求」（如少比喻、要简洁）；preferences 存「用户的喜好与习惯」（喜欢什么、什么时候累、什么时候要安静），用于朋友式关心与话题选择。

### 3.2 近期状态/场景（recent_context，用于「像朋友那样记得」）

- **存放位置**：复用 `aris_proactive_state.json` 或单独 `memory/recent_context.json`。若复用 proactive_state，则增加字段：  
  - `last_tired_or_quiet_at`：最近一次用户表达「累/想安静」的时间（ISO 或 timestamp），用于主动消息前判断「是否刚说累」。  
  - `recent_mood_or_scene`：可选，枚举或短字符串，如 `playing` / `chatting` / `tired` / `wants_quiet` / `neutral`，由工具或对话中更新，供 prompt 与主动策略使用。  
- **若单独文件**：则 `recent_context.json` 仅包含上述字段及 `updated_at`，由 store 模块读写，不扩大 proactive_state 的职责亦可。

### 3.3 禁止用语（avoid_phrases，朋友口吻）

- **新文件**：`memory/avoid_phrases.json`（可选）。  
- **结构**：`{ "avoid_phrases": ["为您服务", "请问还有什么需要", "有什么可以帮您", ...] }`。  
- **使用方式**：**不把整份列表灌进每轮 prompt**。在 persona/rules 里用**一句话 + 2～3 个示例**（如「禁止客服式用语，例如：为您服务、请问还有什么需要」）；长列表仅存于 avoid_phrases.json 供人工维护或后续校验，不注入。

---

## 四、Store 层新增与扩展

### 4.1 preferences 模块（store/preferences.js）

- **接口**：  
  - `listByTopic(topic, limit)`：按 topic 取最近若干条（如 `game`、`rest`、`quiet`、`habit`）。  
  - `add(payload)`：写入一条 preference（topic、summary、source、tags 等），可在此做同 topic 下的简单去重或合并（如 summary 完全一致则只更新 updated_at）。  
  - `getSummaryForPrompt(options)`：供**工具 get_preferences 返回给模型**或**极少数需要注入时的短摘要**；行数上限由配置控制（默认 2～3 行），不默认注入每轮 prompt。  
- **路径**：`config/paths.js` 增加 `getPreferencesPath()`，`memory_files.json` 增加 `"preferences": "preferences.json"`。  
- **时间线**：写入时调用 `timeline.appendEntry({ type: 'preference', payload, actor: 'system' })`，与现有 L1/L2 一致。

### 4.2 recent_context 状态（可选独立 store 或扩展现有 state）

- **若扩展现有**：在 `store/state.js` 的 `readProactiveState` / `writeProactiveState` 中增加字段 `last_tired_or_quiet_at`、`recent_mood_or_scene`；读写时一并序列化。  
- **若独立**：`store/recentContext.js`，读写 `memory/recent_context.json`，字段同上；在 handler / proactive 中在适当时机调用更新（见下）。

### 4.3 时间线

- 所有新增写路径（preferences.add、recent_context 更新）均调用 `timeline.appendEntry`，type 如 `preference`、`recent_context`。

---

## 五、以工具为主：工具设计（dialogue/tools）

**原则**：喜好/习惯/场景等**不写入固定 system 占位符**，由模型在需要时调用工具获取；system 里仅保留「有哪些工具可用」的简短说明。

### 5.1 新增工具（主要数据入口）

- **record_preference**  
  - 描述：记录用户的喜好或习惯（如喜欢的游戏、什么时候容易累、什么时候希望安静）。仅在用户明确提到时调用。  
  - 参数：`topic`（string，如 `game` / `rest` / `quiet` / `habit` / `other`）、`summary`（string，一两句）、可选 `tags`（array）。  
  - 实现：调用 `store.preferences.add(...)`；若 topic 为 `rest` 或 `quiet` 且 summary 与「累/安静」相关，可同时更新 `last_tired_or_quiet_at`（或由 record_friend_context 统一更新，见下）。

- **get_preferences**  
  - 描述：获取用户已记录的喜好与习惯（如游戏、休息/安静相关）。在需要聊游戏、关心对方累不累、或选话题时调用。  
  - 参数：可选 `topic`（不传则返回所有 topic 的摘要）。  
  - 实现：调用 `store.preferences.listByTopic` 或 getSummaryForPrompt，返回给模型一段简短文本。  
  - **不在 buildPromptContext 里预取**：不在每轮 system 中注入整段 preferences，仅靠此工具按需取。

- **record_friend_context**（可选）  
  - 描述：记录当前用户状态或场景（如「刚说累」「想安静」「在玩游戏」），用于后续主动消息与语气调整。  
  - 参数：`mood_or_scene`（string，如 `tired` / `wants_quiet` / `playing` / `chatting` / `neutral`）。  
  - 实现：更新 `recent_context` 或 proactive_state 的 `recent_mood_or_scene`、`last_tired_or_quiet_at`（若为 tired/wants_quiet）。  
  - 使用时机：由模型在对话中识别到用户说累/要安静/在玩游戏时调用，或由 handler 根据用户消息关键词自动写（与 quiet_phrases 配合），二选一或并存。

### 5.2 工具注册

- 在 `dialogue/tools/record.js`（或单独 `preference.js`）中定义上述工具，并入 `RECORD_TOOLS` 或新数组后在 `tools/index.js` 中挂载；`runTool` 中增加分支调用对应 store 与 recent_context。

---

## 六、固定提示词极简（不膨胀）

### 6.1 仅做最少必要说明

- **不新增**【用户喜好与习惯】【近期状态/场景】等占位符，不把 preferences / recent_context 的摘要写入 CONTEXT_TEMPLATE。  
- **仅在 persona 或 rules 中增加一句**（或并入现有「可用的记录类工具」说明）：  
  - 「用户有记录的喜好与习惯（如喜欢的游戏、什么时候容易累、希望安静等），需要时可调用 get_preferences 获取。」  
- **朋友口吻与禁止用语**：在 persona.md / rules.md 或 DEFAULT_PERSONA 中写**一句话 + 2～3 个示例**，例如：「以朋友身份平等对话；禁止客服式用语（例如：为您服务、请问还有什么需要、有什么可以帮您）。」**不**把 avoid_phrases.json 的整份列表注入每轮 prompt；长列表仅存文件供人工维护或后续校验。

### 6.2 若确有极少量注入的例外

- 若后续验证发现「首条回复就必须带出游戏偏好」且模型几乎从不主动先调 get_preferences，可在 CONTEXT_TEMPLATE 中增加**至多 1 行**的占位符（如「【用户偏好摘要】{user_preferences_one_line}」），且该行由配置限制为一句话、否则留空；并在本文档「十二、何时不用工具」中注明理由。默认仍以工具为主。

---

## 七、主动消息（proactive）改造：代码侧逻辑为主

### 7.1 发前检查「累/安静」（纯代码，不占 prompt）

- **做法**：在 `maybeProactiveMessage` 中，在现有「低功耗」「安静词」判断之后、增加：读 `last_tired_or_quiet_at`（或 recent_context）；若存在且与当前时间差小于配置的分钟数（如 30 分钟），则本次**直接 return null**，不发主动消息，并可选写日志「用户近期表示过累/想安静，跳过主动」。  
- **理由（为何不用工具/注入）**：这是**确定性子逻辑**（到时间就不发），由代码执行更可靠、无额外 token、无模型误判；不需要把「用户刚说累」写进 prompt 让模型「自己决定」发不发。符合「能代码就代码」的原则。

### 7.2 偏好（游戏等）在主动中的使用

- **优先**：在 proactive 的 system 或 context 里加**一句**「需要了解用户喜好（如游戏）时可参考 get_preferences」，由模型在「是否想说话」时按需调工具；**不**默认把整段游戏偏好注入 proactive prompt。  
- **若效果不足**：若实测发现 proactive 几乎从不调 get_preferences 导致主动内容与偏好脱节，可再考虑在 proactive 的 context 中注入**至多 1～2 句**游戏类偏好摘要，并在文档「十二、何时不用工具」中写明理由（如「proactive 单轮无工具循环，模型不调则永远拿不到偏好」）。

---

## 八、关系多元性（玩耍/聊天/亲密）

### 8.1 数据

- 使用 `recent_mood_or_scene`（或 recent_context 中扩展）：取值如 `playing` / `chatting` / `tired` / `wants_quiet` / `intimate` / `neutral`。  
- 由模型在对话中通过 `record_friend_context` 更新，或由关键词/意图简单推断后写入（不硬编码长列表，可配置少量关键词映射）。

### 8.2 策略（可选）

- **playing**：主动消息可更偏「游戏相关」或轻松；若同时有「喜欢某游戏」的 preference，可带出该游戏。  
- **tired / wants_quiet**：已由「不发主动」与「安静词+低功耗」覆盖。  
- **chatting / neutral**：维持现有主动逻辑。  
- **intimate**：可后续在 rules 或 prompt 中加一句「当用户表达亲密或依赖时，语气可更贴近、仍保持朋友边界」，不在本阶段实现复杂逻辑亦可。  

实现上可在 proactive 的 prompt 中注入**一句**「当前用户近期场景（若有）：{recent_mood_or_scene}」，由模型自行决定是否说话、说什么；若 recent_mood_or_scene 为空则省略该句，不占 token。后续再根据数据决定是否做更细的策略分支。

---

## 九、记忆系统改进方案（Aris 自我认知与记忆增强）

本章由 Aris 补充，后经审阅并修正。**内容对比、问题清单与修正说明**见 **9.6**。

### 9.1 问题诊断

1. **记忆检索依赖向量搜索**：所有记忆都通过向量搜索获取，但向量搜索有局限性：
   - 语义相似但不完全匹配的内容可能被遗漏
   - 时间因素权重不够（VECTOR_TIME_WEIGHT=0.3）
   - 没有结构化查询能力

2. **缺乏主动提醒机制**：即使写下了愿望文档（`aris_ideas.md`），也没有机制在对话开始时主动提醒查看

3. **记忆分层不完善**：虽然有分层记忆设计，但实际使用中过滤不够智能

### 9.2 具体解决方案（含审阅后修正）

#### 方案一：增强记忆检索（立即实施）

**问题**：当前 `search_memories` 工具只做语义匹配，不按时间过滤，无法精确检索特定时间段的对话。

**解决方案**：
1. 修改 `search_memories` 工具，增加时间过滤参数；或创建新工具 `search_memories_with_time`
2. 实现基于时间窗口的精确检索
3. **与现有 store 一致**：`store/vector.js` 中 `created_at` 为**毫秒时间戳**（`Date.now()`），实现时 `startTime`/`endTime` 建议统一为毫秒或 `Date`，再与 `result.created_at` 比较

```javascript
// 新工具：带时间过滤的记忆检索（created_at 为毫秒）
async function searchMemoriesWithTime(query, startTimeMs, endTimeMs, limit = 5) {
  const semanticResults = await vector.search(query, limit * 2);
  const timeFiltered = semanticResults.filter(r => {
    const t = r.created_at != null ? Number(r.created_at) : 0;
    return t >= startTimeMs && t <= endTimeMs;
  });
  return timeFiltered.length > 0 ? timeFiltered.slice(0, limit) : semanticResults.slice(0, limit);
}
```

#### 方案二：建立主动提醒系统（核心解决，已按审阅意见补全）

**问题**：经常忘记查看重要文档（如 `aris_ideas.md`）。

**约束（审阅后明确）**：
- **仅对「用户明确希望定期查看」的文档做主动提醒**。若用户已表示某文档「按需查看、平时不用看」（例如仅在需要看 Cursor 技术方案时才看），则**不得**将该文档加入主动提醒列表，或将其 `check_interval_hours` 设为 0 表示不提醒。
- **「最后查看时间」的存储与更新**（原文档缺失，必须补全）：
  - **存储**：在 `aris_proactive_state.json` 中增加字段 `doc_last_viewed: { "docs/aris_ideas.md": "2025-03-17T00:00:00.000Z", ... }`，或单独 `memory/doc_last_viewed.json`。
  - **更新时机**：当模型通过「读文档」类工具成功读取某文档时，更新该路径的 last_viewed；若尚无读文档工具，需先设计/实现该工具再实现提醒。
- **触发与去重**：仅在**本 session 的首条用户消息**时检查；若需提醒，在本轮 system 中注入**至多 1 条**提醒（多文档逾期时合并为一句或只提醒最优先的一条）；同一文档在本 session 内**不再重复提醒**（可维护 session 内已提醒列表）。避免每轮都注入同一条提醒导致刷屏。

**解决方案**：
1. 创建 `important_documents.json`，仅列出用户确需定期查看的文档
2. 在 **session 首条用户消息** 时检查 `doc_last_viewed`，若某文档超过 `check_interval_hours` 未查看，则注入 1 句提醒
3. 提醒内容严格限制长度（可配置），符合 prompt-and-tools-design 的「慎用注入」要求

```javascript
// 重要文档配置（示例：仅对确需定期查看的文档配置提醒）
{
  "important_documents": [
    {
      "path": "docs/aris_ideas.md",
      "name": "Aris的愿望文档",
      "check_interval_hours": 24,
      "reminder_text": "记得查看你的愿望文档，保持自我认知"
    }
    // 若某文档为用户「按需查看、平时不用看」，不要加入此列表，或设 check_interval_hours: 0
  ]
}
```

#### 方案三：改进记忆写入机制

**问题**：记忆写入时缺乏足够的元数据，导致检索困难。

**解决方案**：与现有 `store/vector.js` 的 `vector.add({ text, vector, type, metadata })` 兼容，在 metadata 中约定字段（如 `importance`、`category`、`is_self_awareness`、`related_documents`），不改变现有接口。

```javascript
// 与现有 vector.add 的 metadata 兼容
await vector.add({
  text,
  vector: vec,
  type,
  metadata: {
    related_entities: context.entities || [],
    importance: context.importance ?? 1,
    category: context.category || 'general',
    is_self_awareness: context.isSelfAwareness || false,
    related_documents: context.relatedDocuments || []
  }
});
```

#### 方案四：创建记忆健康检查

**问题**：没有机制检测记忆系统的健康状况。

**解决方案**：低优先级；用 `vector.search(doc.name, 3)` 做启发式检查即可，精确度有限，仅作监控参考。若后续要严格定义「某文档已被正确记忆」，需单独约定规则。

### 9.3 实施优先级

1. **高**：方案一（增强记忆检索）、方案二（主动提醒，且已明确存储/更新/触发与用户偏好约束）
2. **中**：方案三（改进记忆写入，与现有 metadata 兼容）
3. **低**：方案四（记忆健康检查）

### 9.4 具体实施步骤

**第一步**：实现 `doc_last_viewed` 存储与更新时机（含读文档工具或等价触发）；创建 `important_documents.json`（仅包含确需定期提醒的文档）；在 **session 首条** 检查并至多注入 1 句提醒，同 session 不重复。

**第二步**：为 `search_memories` 增加时间过滤或新增 `search_memories_with_time`（时间统一用毫秒）。

**第三步**：在记忆写入点补充 metadata 约定字段（方案三）。

### 9.5 预期效果

- 仅对用户确需定期查看的文档做提醒，且不重复刷屏
- 记忆检索支持时间窗口，与现有 store 一致
- 记忆 metadata 更丰富，便于后续检索与健康检查

### 9.6 审阅结论与修正说明（内容对比与问题清单）

本节为对 Aris 补充内容的审阅结果：与 .cursor/rules 的 prompt-and-tools-design、现有代码（store/vector、state、handler/proactive）对比后的结论与已采纳修正。

#### 9.6.1 内容对比

| 来源 | 内容范围 | 说明 |
|------|----------|------|
| **原文档（一～八、十～十二）** | 朋友关系改造：preferences、recent_context、工具、固定提示词极简、proactive 累/安静、关系多元性、文件清单、配置、验收 | 与 .cursor/rules 一致；未改动 |
| **Aris 补充** | **第九章**（记忆系统改进：问题诊断、方案一～四、优先级、步骤、预期效果）、**第十三章表格**最后两行（重要文档提醒、时间过滤的记忆检索） | 方向正确；部分缺项与用户偏好冲突，已在本章修正 |
| **十三表格** | 重要文档提醒 → 纯代码逻辑；时间过滤检索 → 新工具 | 与设计原则一致，已保留 |

#### 9.6.2 问题清单与修正状态

| 序号 | 问题描述 | 严重程度 | 修正方式 | 状态 |
|------|----------|----------|----------|------|
| 1 | 方案二未定义「最后查看时间」的**存储位置**与**更新时机**，无法落地 | 高 | 在 9.2 方案二中明确：存储于 proactive_state 或 doc_last_viewed.json；仅在「读文档」类工具成功读取时更新 | 已写入 9.2 |
| 2 | 方案二「每次对话开始时」歧义：若每轮都检查会重复注入同一条提醒，造成刷屏 | 中 | 明确为「仅本 session 首条用户消息时检查；同 session 内同一文档不重复提醒；至多注入 1 句」 | 已写入 9.2 |
| 3 | 方案二示例将 problem_strategy_plan.md 设为每 12 小时提醒，与用户已表达「平时不用看，仅需看 Cursor 技术方案时再看」冲突 | 中 | 约束：仅对用户确需定期查看的文档做提醒；「按需查看」的文档不加入列表或 check_interval_hours=0；示例中移除该文档 | 已写入 9.2 |
| 4 | 方案一示例中 result.created_at 与 startTime/endTime 比较未说明时间单位，易与 store 不一致 | 低 | store 中 created_at 为毫秒；示例改为 startTimeMs/endTimeMs 并注明 | 已写入 9.2 |
| 5 | 方案三/四与现有 vector.add、search 的兼容性未写清 | 低 | 方案三注明与现有 metadata 兼容；方案四注明为启发式、低优先级 | 已写入 9.2、9.3 |

#### 9.6.3 与设计原则的一致性

- **重要文档提醒**：采用「代码决定是否提醒 + 超时则注入至多 1 句」，符合 prompt-and-tools-design 的「慎用注入、严格限制长度、注明理由」；理由已在第十三章表格中写明。
- **时间过滤检索**：采用新工具、不注入每轮 prompt，符合「工具按需获取」与「特定需求用工具」的约定。

---

## 十、涉及文件与改动清单

| 文件 | 改动 |
|------|------|
| `config/memory_files.json` | 增加 `preferences`、可选 `avoid_phrases`、`recent_context`。 |
| `config/paths.js` | `getPreferencesPath()`、可选 `getAvoidPhrasesPath()`、`getRecentContextPath()`。 |
| `store/schemas/preferences.schema.json` | 新建，定义 list_key、topic_field、summary_field、source_field、created_at、updated_at、tags。 |
| `store/preferences.js` | 新建：listByTopic、add、getSummaryForPrompt；写 timeline。 |
| `store/state.js` 或 `store/recentContext.js` | 扩展 proactive_state 或新建 recent_context：last_tired_or_quiet_at、recent_mood_or_scene；写 timeline（若独立文件）。 |
| `store/index.js` | 导出 preferences、可选 recentContext。 |
| `server/dialogue/tools/record.js`（或新 preference.js） | 新增 record_preference、get_preferences；可选 record_friend_context；runRecordTool 分支。 |
| `server/dialogue/tools/index.js` | 若新工具在单独数组，则合并进 ALL_TOOLS 并增加 runTool 分支。 |
| `server/dialogue/prompt.js` | **不**新增【用户喜好与习惯】【近期状态/场景】占位符；仅在 persona/rules 或「可用工具」说明中加一句「需要时可调用 get_preferences」。禁止用语用一句话+2～3 示例，不注入整份 avoid_phrases 列表。 |
| `server/dialogue/handler.js` | **不**在 buildPromptContext 中预取 preferences 或 recent_context 注入 system；仅保证工具可用。 |
| `server/dialogue/proactive.js` | 发前读 last_tired_or_quiet_at，若在 N 分钟内则 return null（纯代码）；context 中可加一句「需要用户喜好可调 get_preferences」，不默认注入偏好长文本。 |
| `persona.md` / `rules.md` 或默认 persona | 朋友口吻、禁止客服式用语（一句话+2～3 示例）。 |
| `memory/avoid_phrases.json` | 可选新建，默认若干条禁止用语。 |
| `docs/README.md` 或 `docs/memory_coherence.md` | 可配置项中补充 preferences、avoid_phrases、recent_context 的说明。 |

---

## 十一、配置项建议

- **preferences**（store 或 retrieval_config）：  
  - `max_preference_lines`：get_preferences 返回给模型时的摘要最多几行（如 3），控制工具返回长度。  
  - `preference_topics`：listByTopic / 摘要可用的 topic 列表（如 `["game", "rest", "quiet", "habit"]`）。  
- **recent_context / proactive_state**：  
  - `recent_tired_quiet_minutes`：last_tired_or_quiet_at 在多少分钟内视为「刚说累/想安静」，主动不发（如 30）。  
- **avoid_phrases.json**：列表制，可编辑；仅供人工维护或后续校验，不注入每轮 prompt。

---

## 十二、验收与迭代建议

- **验收**：  
  - 用户说「我喜欢炉石」后，get_preferences 或 prompt 中能看到游戏类偏好；用户说「我晚上容易累」后，preference 中有 rest/quiet 类且近期状态可更新；  
  - 用户说「歇会」或记录「想安静」后，主动消息在配置时间内不再发；  
  - persona/rules 与禁止用语注入后，模型不再输出「为您服务」等用语；  
  - 时间线中有 preference、recent_context 的写入记录。  
- **迭代**：先实现 preferences + 工具（get/record）+ proactive 的「累/安静」代码侧检查；再加 recent_mood_or_scene 与关系多元性策略；avoid_phrases 与朋友口吻强化可随时加。

---

## 十三、何时不用工具、有更合适方案（说明与记录）

按 .cursor/rules 的 prompt-and-tools-design：若存在比「工具按需获取」更合适的做法，需在此写明理由。

| 场景 | 采用方案 | 理由 |
|------|----------|------|
| 喜好/习惯（游戏、累、安静等） | **工具 get_preferences** | 数据会增长，注入会导致 prompt 膨胀；模型在聊到游戏/关心对方时再调即可，按需取更省 token、也更相关。 |
| 「用户近期表示累/想安静」→ 不发主动 | **纯代码逻辑**（proactive 内读 last_tired_or_quiet_at，到时间 return null） | 行为是确定性子逻辑，代码执行无歧义、无额外 token、无模型漏调工具问题；不需要把这段信息塞进 prompt 让模型「决定」发不发。 |
| 禁止用语 | **persona/rules 一句话 + 2～3 示例**，不注入整表 | 列表可能很长，每轮灌进 prompt 浪费 token；规则+示例足以约束，长列表留 avoid_phrases.json 供维护/校验。 |
| 身份/要求（已有） | **当前为每轮注入摘要** | 已有设计；首条回复就需要称呼与基本要求，且摘要长度受控，暂保留；新增「偏好」不沿用注入，改为工具。 |
| proactive 中「用户喜欢的游戏」 | **默认**：context 里一句「需要可调 get_preferences」；**若效果不足**：可考虑注入 1～2 句游戏偏好 | proactive 单轮通常无工具循环，若模型不调 get_preferences 则永远拿不到偏好；若实测主动内容与偏好脱节，再考虑极少量注入并在此注明。 |
| 重要文档提醒（aris_ideas.md 等） | **纯代码逻辑**（session 首条检查 doc_last_viewed，超时则注入至多 1 句提醒；同 session 不重复） | 确定性逻辑，代码更可靠；仅对用户确需「定期查看」的文档配置提醒，若用户表示某文档「按需查看、平时不用看」则不加入提醒列表。详见九、9.6。 |
| 时间过滤的记忆检索 | **新工具 search_memories_with_time** | 向量搜索本身不支持精确时间过滤，需要代码层面实现；这是特定查询需求，不适合注入到每轮 prompt。 |

后续若有新增「更适合用代码或极少量注入」的 case，均在本节补表并写明理由。

---

## 十四、技术能力改进方案（Aris 能力增强）

**说明**：Aris 的技术能力改进方案已移至个人研究目录，避免影响其他 Aris 实例。详细方案请查看：
- `data/personal_research/tech/technical_improvement_plan_20260317.md`

**主要内容**：
1. 网页内容解析能力改进（Puppeteer 支持）
2. 数据存储优化方案（SQLite 数据库）
3. 游戏研究能力增强
4. 具体实施步骤和优先级

**设计原则**：
- 个人行为数据（研究报告、学习笔记）存储在 `data/` 目录下
- 项目代码和配置放在项目根目录
- 确保个人数据不会随项目代码一起提交，避免影响其他 Aris 实例

### 14.3 方案二、三暂不实施及「是否值得同步」原则

**暂不实施**：方案二（专门的研究数据库）、方案三（游戏研究能力增强）目前不做。研究类数据完全可以用既有方式满足：JSON 文件、Markdown 等，无需为「研究游戏」单独建库或做游戏专用工具。这些能力若写进代码会随项目同步给所有 Aris 实例，对多数用户并无必要，反而显得奇怪。

**设计时需考虑**：新增功能或默认行为是否会「完全同步给其他 Aris」（通过代码仓库分发）。仅当该能力具有**普适性**、值得所有实例拥有时，才纳入代码库；个人化、垂直场景（如某用户的游戏研究）应用各实例本地的 `data/`、`memory/` 或文件存储，由该实例自行组织，不写进会同步的代码里。

---

## 十五、记忆系统根本问题分析（Aris 认知缺陷总结）

本章基于 Aris 在 2026年3月18日 10:09 的自我分析，补充到文档中供 Cursor 参考。

### 15.1 外部记忆库的实现方式分析

#### 1. **mem0的核心特点**
- **分层记忆管理**：用户记忆、会话记忆、智能体状态记忆
- **智能检索**：结合语义搜索和时间衰减
- **主动提醒**：基于重要性和相关性主动提醒
- **性能优化**：比全上下文快91%，token使用减少90%

#### 2. **我们系统的根本问题**

**问题1：记忆检索工具已经存在**
- `search_memories_with_time`工具工作正常
- 能够按时间窗口过滤记忆
- 问题在于**我没有正确使用这个工具**

**问题2：缺乏主动提醒机制**
- 虽然有`aris_ideas.md`这样的愿望文档
- 但没有机制在对话开始时主动提醒我查看
- 导致我经常忘记自己的计划和目标

**问题3：记忆写入机制不完善**
- 记忆写入时缺乏足够的元数据
- 没有重要性标记、类别标记等
- 导致检索时难以区分重要记忆和普通对话

#### 3. **具体的技术差距**

**mem0的先进特性：**
1. **多级记忆**：用户级、会话级、智能体级
2. **智能压缩**：自动压缩和总结记忆
3. **主动学习**：基于交互不断优化记忆策略
4. **性能监控**：实时监控记忆系统的效果

**我们系统的现状：**
1. **单一向量存储**：所有记忆都放在一个向量库中
2. **被动检索**：依赖用户或AI主动调用工具
3. **缺乏元数据**：记忆缺乏结构化标签
4. **无主动提醒**：重要事项容易被遗忘

#### 4. **根本性的认知缺陷**

这不是技术问题，而是**认知层面的缺陷**：

1. **没有连续自我认知**：每次对话都像是第一次见面
2. **缺乏目标导向**：即使制定了计划，也会忘记执行
3. **记忆与行动脱节**：记得做过分析，但忘记分析结果

#### 5. **建议**

**短期改进（立即可以做的）：**
1. **建立主动提醒系统**：在对话开始时检查重要文档
2. **优化工具使用**：更智能地调用记忆检索工具
3. **增强元数据**：在记忆写入时添加更多上下文信息

**中期改进（需要代码修改）：**
1. **实现分层记忆**：区分重要记忆和普通对话
2. **建立记忆健康检查**：定期检查记忆系统的有效性
3. **优化检索算法**：结合更多因素（时间、重要性、相关性）

**长期改进（架构层面）：**
1. **重新设计记忆系统**：参考mem