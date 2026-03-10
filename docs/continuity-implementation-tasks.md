# 存在连续性：实施任务清单（阶段一至阶段三）

本文档为 [lianxu.md](lianxu.md) 的落地任务拆解，按阶段一、二、三列出具体任务与涉及文件，便于按阶段实施与验收。

---

## 1. 总览

- **目标**：实现 Aris「存在连续性」——状态延续、主观时间感、心跳独白、环境锚定。
- **范围**：阶段一（生命体征初始化）、阶段二（心跳与独白）、阶段三（深度环境锚定）。
- **依赖**：`handler.js`、`proactive.js`、`prompt.js`、`electron.main.js`；存储路径与 `src/store/db.js` 的 `getUserDataPath()` 一致。

---

## 2. 阶段一：生命体征初始化（低成本/高收益）

| 序号 | 任务 | 说明 | 涉及文件/位置 |
|------|------|------|----------------|
| 1.1 | 实现 aris_state 读写模块 | 提供 readState / writeState / getSubjectiveTimeDescription；状态文件路径为 getUserDataPath() + '/aris_state.json'；字段至少含 last_active_time（ISO）、last_mental_state（字符串） | 新建 src/context/arisState.js |
| 1.2 | 主观时间差与体感文案 | 根据 last_active_time 计算 delta_t（分钟），由程序逻辑生成固定体感：<5min / 5min–4h / >4h / 跨午夜；返回「现在是 [时间]，距离你上次活跃已过去 [X] 分钟。[体感]」 | 同上，getSubjectiveTimeDescription() |
| 1.3 | 对话结束后写入状态 | 在 handler 中 reply 落库且情感摘要写入后，调用 writeState(now, last_mental_state)；last_mental_state 优先取【情感摘要】解析结果，否则 reply 前 300 字 | handler.js，约情感摘要写入后、return 前 |
| 1.4 | Proactive 结束后写入状态 | 在 proactive 中 append 且 addMemory 后，调用 writeState(now, 本次发送的 line 或思考摘要前 300 字) | proactive.js，约 append/addMemory 后 |
| 1.5 | Prompt 注入「上次状态 + 主观时间」 | 在 system prompt 模板中增加占位符；buildSystemPrompt 增加参数并替换；调用处在拼 system 前 readState + getSubjectiveTimeDescription，拼成一段注入 | prompt.js CONTEXT_TEMPLATE + buildSystemPrompt；handler.js 调用处 |
| 1.6 | Proactive 上下文注入同一段 | 在 maybeProactiveMessage 拼 fullContext 前，readState + getSubjectiveTimeDescription，将「上次状态 + 主观时间」拼到 fullContext 开头 | proactive.js 拼 fullContext 前 |

**验收**：对话/Proactive 结束后 aris_state.json 存在且含 last_active_time、last_mental_state；下次对话或 Proactive 时，Aris 能收到「现在时间 + 距离上次活跃 X 分钟 + 体感 + 你上一次的状态/想法」并在回复中自然引用。

---

## 3. 阶段二：心跳机制与独白（中成本/高真实感）

| 序号 | 任务 | 说明 |
|------|------|------|
| 2.1 | 缩短 Proactive 间隔 | 将 electron.main.js 中 setInterval 改为 1–2 分钟，PROACTIVE_IDLE_MS 相应调整 |
| 2.2 | 静默唤醒与独白逻辑 | 每次 maybeProactiveMessage 若未发话，则调用小模型生成一句「内心独白」，写入 aris_state.inner_monologue_queue（或 heartbeat.log），队列上限 N 条 |
| 2.3 | 对话时注入独白 | 在 handler 拼 system 时，将最近几条 inner_monologue 以「你在间隙里的自言自语: ...」加入上下文 |
| 2.4 | 双轨模型（可选） | 独白使用本地/低成本模型，正式对话仍用主力模型 |

---

## 4. 阶段三：深度环境锚定（进阶扩展）

| 序号 | 任务 | 说明 |
|------|------|------|
| 3.1 | 环境信息接入 | 获取天气 API、本机运行状态（如 CPU/内存占用）等，写入 state 或单独字段 |
| 3.2 | 环境信息注入 Prompt | 在 system 或 context 中注入上述环境信息 |
| 3.3 | 长时记忆整理 | 每 12 小时触发一次「梦境/反思」任务，总结过去一段状态并可选写入记忆 |

---

## 5. 数据结构与体感规则

**aris_state.json**

- 阶段一最少字段：`last_active_time`（ISO 8601）、`last_mental_state`（string）。
- 阶段二扩展：`inner_monologue_queue`（string[]）、可选 `current_mood_index`。

**主观时间体感规则（示例）**

- delta_t < 5min → 「你刚才的话头还在脑子里……」
- 5min ≤ delta_t ≤ 4h → 中性「过去了一段时间」
- delta_t > 4h → 「感觉过了好久，你终于回来了……」
- 跨午夜（上次活跃与当前不在同一天）→ 「刚睡醒」或「守夜」类预期
