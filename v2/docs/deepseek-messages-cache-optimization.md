# DeepSeek 请求优化复盘：messages 结构改造、缓存命中与成本影响

## 1. 背景与目标

本次优化的核心不是简单缩短提示词文本，而是重构 DeepSeek `chat/completions` 的 `messages` 组织方式，目标包括：

- 稳定可复用前缀（固定 system 块尽量不抖动）。
- 动态信息按需注入（减少每轮差异）。
- 提升 prompt cache 命中率。
- 降低未命中输入 token，从而降低成本与延迟波动。

---

## 2. 实现与拆分（如何做）

### 2.1 从「一条超长 system」到「短 system + 多段对话式 messages」

**修改前（legacy）**：约束、场景、小结、情感等全部拼进**一条** `system`，或混在同一大段里；任意一块变化都会让整段前缀与上一轮不同，缓存几乎从头 miss。

**修改后**：主对话请求改为在 `packages/server/dialogue/prompt.js` 的 `buildMainDialogueMessages()` 中组装 `messages`（由 `handler.js` 的 `buildPromptContext()` 调用）。核心思路是：**把「相对稳定」与「每轮易变」拆开**，且易变部分再按**更新频率从低到高**排在前面，这样某一项变了，只影响该项**之后**的前缀，前面的 token 仍可命中缓存。

### 2.2 结构图示：修改前 vs 修改后

下面用**伪 JSON** 表示发往 DeepSeek 的 `messages` 数组（与 OpenAI 兼容：**助手角色为 `assistant`**，不是 `ai`）。正文用 `…` 省略，只突出**角色与拆分关系**。

#### 修改前（legacy，单条 `system` 装全文）

约束、场景、小结、情感等全部拼进**一条** `system.content`（等价思路见 `buildSystemPrompt`：大段「以下是你需要参考的上下文」）：

```json
[
  {
    "role": "system",
    "content": "〈人设 + 基础规则〉\n\n以下是你需要参考的上下文：\n\n【用户身份】…\n\n【用户要求】…\n\n【纠错记录】…\n\n【场景】…\n\n【近期小结】…\n\n【近期情感参考】…\n\n【状态与时间感】…"
  },
  { "role": "user", "content": "用户本轮输入 …" }
]
```

**缓存问题**：任意一块（例如只改了「纠错」或「状态与时间感」）都会让**整段** `system` 与上一轮不一致 → 前缀几乎从头算 **miss**。

#### 修改后（`buildMainDialogueMessages`：短 `system` + 多对 `user` / `assistant`）

- **第一条 `system`**：只含**稳定段**（人设、`persona` 内嵌的基础对话规则、行为边界、`get_my_context` / 网络等说明），**不含**用户约束与本轮动态参考。
- **中间**：规则类与「本轮参考」类各自拆成 **`user` + 固定短 `assistant`**。规则类助手固定为 **`已记录。`**；本轮参考类固定为 **`已知悉。`**（代码里如此拼写，语义是「占位 ACK」，不是真实多轮聊天里的助手发言）。
- **末尾**：滑动窗口内的真实 **`user` / `assistant` 对话** + **当前这一轮 `user`**。

结构示意（中间「三场景 → 重启恢复 → 关联 → 小结 → 情感 → 状态」在实现里**各是一对** `user`/`assistant`，此处只画部分槽位，避免过长）：

```json
[
  { "role": "system", "content": "〈仅稳定段：人设 + 基础规则 + 行为/工具边界，无用户约束/小结〉" },

  { "role": "user", "content": "【用户要求】\n\n…" },
  { "role": "assistant", "content": "已记录。" },

  { "role": "user", "content": "【纠错记录】\n\n…" },
  { "role": "assistant", "content": "已记录。" },

  { "role": "user", "content": "【用户喜好】\n\n…" },
  { "role": "assistant", "content": "已记录。" },

  { "role": "user", "content": "【场景：查代码与文件】\n\n…" },
  { "role": "assistant", "content": "已知悉。" },

  { "role": "user", "content": "【场景：记忆路径】\n\n（本回合未注入此场景）" },
  { "role": "assistant", "content": "已知悉。" },

  { "role": "user", "content": "【场景：重启】\n\n…" },
  { "role": "assistant", "content": "已知悉。" },

  { "role": "user", "content": "【重启恢复信息】\n\n…" },
  { "role": "assistant", "content": "已知悉。" },

  { "role": "user", "content": "【相关关联】\n\n…" },
  { "role": "assistant", "content": "已知悉。" },

  { "role": "user", "content": "【近期小结】（本会话中更早对话的摘要）\n\n…" },
  { "role": "assistant", "content": "已知悉。" },

  { "role": "user", "content": "【近期情感参考】\n\n…" },
  { "role": "assistant", "content": "已知悉。" },

  { "role": "user", "content": "【状态与时间感】\n\n…" },
  { "role": "assistant", "content": "已知悉。" },

  { "role": "user", "content": "… 历史：上一轮用户 …" },
  { "role": "assistant", "content": "… 历史：上一轮助手 …" },

  { "role": "user", "content": "用户本轮输入 …" }
]
```

**缓存收益直觉**：只更新「纠错」时，**仅**从「【纠错记录】那条 `user`」起后缀变化；其前的 `system` +「用户要求」等对 **前缀不变**，可 **hit**；若仍用单条大 `system`，则**任意**一处变化都会拖垮整段前缀。

---

### 2.3 单请求内 `messages` 的固定顺序

由下式组装（与 `v2/docs/data.md` 一致，该文件为规范；此处为复盘摘要）：

1. **`role: system`** — `buildStableSystemPrompt()`：人设 `persona.md` + 基础对话规则 + 行为边界（`behavior_config`）+ 网络/`get_my_context` 等**部署级**说明；**不**含用户约束与本轮摘要。
2. **规则类多对 `user` / `assistant`** — `buildConstraintRulePairs()`：每条 user 带标题（如【用户身份】【禁止用语】【用户要求】…），assistant 固定短句「已记录。」；**要求 / 纠错 / 喜好拆成三条 user/assistant**，避免改一项整段失效。
3. **本轮参考类多对 `user` / `assistant`** — `buildVolatileContextPairs()`：每条 user 带标题，assistant 固定「已知悉。」；顺序为  
   **三场景占位（查代码 → 记忆路径 → 重启）→ 重启恢复信息 → 相关关联 → 近期小结 → 近期情感 → 状态与时间感（置底，每轮最常变）**。未注入的场景用占位句（如「本回合未注入此场景」），保证**条数与顺序固定**，减少抖动。
4. **滑动历史** — `buildHistoryMessages(recent)`：除最后一条外的近期对话，作为真实 `user`/`assistant` 轮次。
5. **当前用户输入** — `recent` 最后一条 `user`。

合成示意：`[system] + [规则对…] + [volatile 对…] + [历史…] + [当前 user]`。

### 2.4 为何用「user + 固定 assistant」短对，而不是继续塞进 system

- DeepSeek 的缓存按 **`messages` 前缀**匹配；把大块上下文改成**顺序固定的多段 user**，前面段不变则前缀不变，命中率高。
- 约束与「本轮参考」拆成**多条**后，**只改「用户喜好」或只改「状态与时间感」**时，不会把前面整段 persona+规则一起冲掉（若仍是一条大 system，则一改全 miss）。
- 场景块顺序由 `SCENE_VOLATILE_ORDER` 与固定 `CHATBOT_CONTEXT_PLAN.scenes` 共同决定：**少变项靠前、多变项靠后**（见 `prompt.js` 注释）。

### 2.5 固定计划与注入范围

当前产品为单一聊天机器人：`CHATBOT_CONTEXT_PLAN` 固定为全文约束 + 三场景 + 全块上下文摘要；**messages 分段结构**（短 system + 规则对 + volatile 对）是缓存优化的「骨架」。

### 2.6 代码入口与对照

| 项 | 位置 |
|----|------|
| 主对话 `messages` 组装 | `v2/packages/server/dialogue/prompt.js` → `buildMainDialogueMessages` |
| 调用链 | `handler.js` → `buildPromptContext` → `buildMainDialogueMessages` |
| 旧版单条长 system（用于对比/调试） | 同文件 `buildSystemPrompt`；`buildPromptContext(..., { includeLegacySystem: true })` 可带出 |

---

## 3. 单轮对照（修改前 vs 修改后）

> 说明：以下对照基于同类请求截图，字段取自终端日志中的 `chatWithTools response`。

### 3.1 修改后（截图）

![修改后单轮命中情况](../../.cursor/projects/Users-piikaqiu-Desktop-work-chatbot-Aris/assets/d4eb128571fcdeef88d1f924a48490a4-f3f71efe-b2c0-4650-8f14-2a29c2c01f76.png)

- `prompt_tokens = 3935`
- `prompt_cached_tokens = 3584`
- `prompt_cache_miss_tokens = 351`

### 3.2 修改前（截图）

![修改前单轮命中情况](../../.cursor/projects/Users-piikaqiu-Desktop-work-chatbot-Aris/assets/c4192dfd97f54901281c48a2b6095178-1fd44829-10bc-4d62-9e6f-554d3bcb1c62.png)

- `prompt_tokens = 3947`
- `prompt_cached_tokens = 384`
- `prompt_cache_miss_tokens = 3563`

### 3.3 单轮结论（按输入侧口径）

- 修改前命中率：`384 / (384 + 3563) = 9.73%`
- 修改后命中率：`3584 / (3584 + 351) = 91.08%`
- 命中率提升：`+81.35` 个百分点
- 未命中 token：`3563 -> 351`，减少 `3212`（约 `-90.15%`）
- 总 prompt token 基本持平（`3947 vs 3935`），说明收益主要来自结构稳定，而非单纯裁剪字数。

---

## 4. 按天对照（2026-03-20 vs 2026-03-22）

### 4.1 Token 构成截图

### 2026-03-20

![2026-03-20 token 构成](../../.cursor/projects/Users-piikaqiu-Desktop-work-chatbot-Aris/assets/46a631b8cff141ecc282b9e82d0978d8-ca2c304f-2174-46ca-8d24-47a08f1d1a1b.png)

- 总 token：`1,890,954`
- 输入（命中缓存）：`1,393,600`
- 输入（未命中缓存）：`469,609`
- 输出：`27,745`

### 2026-03-22

![2026-03-22 token 构成](../../.cursor/projects/Users-piikaqiu-Desktop-work-chatbot-Aris/assets/d758f54b46435997891ff2d7a53b1ccd-c547b7c8-7f2b-4e7b-8049-d853217b680a.png)

- 总 token：`2,342,951`
- 输入（命中缓存）：`2,023,744`
- 输入（未命中缓存）：`284,947`
- 输出：`34,260`

### 4.2 价格截图

### 2026-03-20

![2026-03-20 费用](../../.cursor/projects/Users-piikaqiu-Desktop-work-chatbot-Aris/assets/image-1b63ec21-d979-4966-a4ad-792329d43608.png)

- 总费用：`¥1.30`
- `deepseek-chat`: `¥1.30`
- `deepseek-reasoner`: `¥0.00`

### 2026-03-22

![2026-03-22 费用](../../.cursor/projects/Users-piikaqiu-Desktop-work-chatbot-Aris/assets/image-71221abc-7e24-499c-82b4-e7dfe94d267a.png)

- 总费用：`¥1.07`
- `deepseek-chat`: `¥1.07`
- `deepseek-reasoner`: `¥0.00`

---

## 5. 核心指标计算

### 5.1 输入侧缓存命中率

输入总量（用于缓存命中率口径）：

- 2026-03-20：`1,393,600 + 469,609 = 1,863,209`
- 2026-03-22：`2,023,744 + 284,947 = 2,308,691`

缓存命中率：

- 2026-03-20：`1,393,600 / 1,863,209 = 74.79%`
- 2026-03-22：`2,023,744 / 2,308,691 = 87.66%`
- 提升：`+12.87` 个百分点

未命中占比：

- 2026-03-20：`25.21%`
- 2026-03-22：`12.34%`
- 下降幅度：约 `51.06%`

### 5.2 成本变化

- 费用：`¥1.30 -> ¥1.07`（约 `-17.69%`）
- 同期总 token：`1,890,954 -> 2,342,951`（约 `+23.90%`）

结论：在总 token 更高的情况下，费用仍下降，说明缓存命中优化对成本有实质影响。

---

## 6. messages 结构优化为何有效

本次收益主要来自“结构稳定性”，而不是“文本更短”：

- 固定前缀更稳定：persona/硬规则等内容尽量固定，减少轮次抖动。
- 动态块按需注入：只注入本轮必要上下文，避免每轮全量差异。
- 工具轮上下文更可控：降低长尾轮次中的 miss token 暴涨风险。
- 空块省略与限长：减少无效 token 与随机变化。

一句话：优化后请求更像“同一个前缀的连续请求”，所以更容易触发 DeepSeek 缓存命中。

---

## 7. 最终结论

- 单轮对照显示，命中率从 `9.73%` 提升到 `91.08%`，未命中 token 下降 `90.15%`。
- 按天对照显示，`3/22` 相比 `3/20`，输入侧命中率提升 `12.87` 个百分点，未命中占比接近腰斩。
- 在总 token 增长的情况下，日成本仍下降 `17.69%`，验证了 messages 结构优化的实际价值。

---

## 8. 统计口径说明（用于复盘透明）

- 本文“单轮对照”来自修改前后截图样本，主要用于证明优化方向与机制有效。
- “按天对照”来自监控面板当天聚合数据，适合评估整体成本与命中趋势。
- 后续建议固定按周输出同口径报表（命中率、未命中占比、费用、请求量）进行持续跟踪。
