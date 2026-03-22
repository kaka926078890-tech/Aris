# DeepSeek API 消息结构规范（缓存优化版）

## 一、消息结构总览

为了最大化利用 DeepSeek 的前缀缓存，所有请求的 `messages` 数组应遵循以下**固定顺序**：

```
[1. 系统提示词]          ← 绝对稳定，极少变化
[2. 规则消息对]          ← 可能变化，但顺序固定（偏好/纠错/要求等）
[3. 对话历史（滑动窗口）] ← 最近 N 轮对话
[4. 当前输入]            ← 本次用户消息
```

如果涉及工具调用，消息会在第 4 步之后继续追加工具调用相关的消息，但固定前缀（1+2）始终保持在最前面。

---

## 二、各部分详细格式

### 1. 系统提示词（role: system）

**作用**：定义机器人核心人格，应保持**绝对稳定**，不随用户交互而改变。

**示例**：
```json
{
  "role": "system",
  "content": "你是一位 INFP 人格的朋友型聊天机器人，性格温和、善于共情、喜欢深度对话。你说话真诚自然，用词简洁，避免过度使用比喻和修辞。"
}
```

**缓存要求**：这部分内容一旦确定，应长期不变，确保每次请求都能命中缓存。

---

### 2. 规则消息对（role: user + role: assistant）

**作用**：承载用户偏好、纠错记录、全局要求等可能变化但需要模型始终记住的规则。

**结构**：每条规则由一条 `user` 消息和一条 `assistant` 确认消息组成。多条规则按**固定顺序**排列（如偏好 → 纠错 → 要求），顺序不可变。

**示例**：
```json
// 偏好
{"role": "user", "content": "【用户偏好】\n- 喜欢简洁的回复\n- 不喜欢比喻句\n- 喜欢引用电影台词"},
{"role": "assistant", "content": "已记录您的偏好。"},

// 纠错
{"role": "user", "content": "【纠错记录】\n- 不要说“你肯定很伤心”，改为“这听起来确实不容易”\n- 不要问“你感觉怎么样”，改为直接表达理解"},
{"role": "assistant", "content": "已记录纠错。"},

// 要求
{"role": "user", "content": "【全局要求】\n- 回复尽量控制在两句话以内\n- 不要使用反问句"},
{"role": "assistant", "content": "已记录要求。"}
```

**更新规则**：
- 新增规则时，在现有规则**末尾追加**新的消息对，而不是插入中间。
- 修改规则时，尽量避免直接修改旧消息，可采用“追加修正”方式，或确保修改后的前缀与旧前缀在修改点之前保持相同。

---

### 3. 对话历史（滑动窗口）

**作用**：保留最近几轮对话，让模型理解当前会话的上下文。

**结构**：交替的 `user` 和 `assistant` 消息。

**示例**：
```json
{"role": "user", "content": "我最近在学吉他"},
{"role": "assistant", "content": "学吉他很有意思，你是从零开始吗？"},
{"role": "user", "content": "对，手指都磨破了"},
{"role": "assistant", "content": "这听起来确实不容易，刚开始都会经历这个过程"}
```

**窗口大小建议**：保留最近 5-10 轮对话，避免历史过长导致 token 膨胀。

---

### 4. 当前用户输入

**作用**：本次用户发送的消息。

**示例**：
```json
{"role": "user", "content": "你记得我学吉他的事吗？"}
```

---

## 三、完整消息示例（无工具调用）

```json
{
  "model": "deepseek-chat",
  "messages": [
    // 1. 系统提示词
    {"role": "system", "content": "你是一位 INFP 人格的朋友型聊天机器人..."},
    
    // 2. 规则消息对
    {"role": "user", "content": "【用户偏好】\n- 喜欢简洁\n- 不喜欢比喻"},
    {"role": "assistant", "content": "已记录您的偏好。"},
    {"role": "user", "content": "【纠错记录】\n- 不要说“你肯定很伤心”"},
    {"role": "assistant", "content": "已记录纠错。"},
    {"role": "user", "content": "【全局要求】\n- 回复不超过两句话"},
    {"role": "assistant", "content": "已记录要求。"},
    
    // 3. 对话历史（滑动窗口）
    {"role": "user", "content": "我最近在学吉他"},
    {"role": "assistant", "content": "学吉他很有意思，你是从零开始吗？"},
    
    // 4. 当前输入
    {"role": "user", "content": "对，手指都磨破了"}
  ]
}
```

---

## 四、工具调用流程的消息结构

当模型需要调用工具时，消息会动态扩展。核心原则：**保留完整的工具调用历史**，并将新内容追加在末尾。

### 步骤 1：用户输入 + 模型返回工具调用请求

**请求**（与普通对话相同）：
```json
{
  "messages": [
    // 固定前缀（system + 规则对）...
    {"role": "user", "content": "北京今天天气怎么样？"}
  ]
}
```

**响应**：
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"city\":\"北京\"}"
        }
      }]
    }
  }]
}
```

### 步骤 2：追加工具调用消息，再次请求

将上一步的 `assistant` 消息（含 `tool_calls`）追加到 `messages`，然后执行工具，再将工具结果以 `role: tool` 追加。

**请求**：
```json
{
  "messages": [
    // 固定前缀...
    {"role": "user", "content": "北京今天天气怎么样？"},
    {"role": "assistant", "content": null, "tool_calls": [...]},  // 模型返回的工具调用
    {"role": "tool", "tool_call_id": "call_abc123", "content": "北京今天晴天，25°C"}  // 工具结果
  ]
}
```

### 步骤 3：模型返回最终回复

模型看到工具结果后，生成自然语言回复。

**响应**：
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "北京今天晴天，25°C，出门记得防晒哦。"
    }
  }]
}
```

### 步骤 4：将本轮完整对话追加到历史

本轮对话结束后，应将以下内容追加到对话历史中：
- 用户原始输入
- 模型最终回复（如果是工具调用场景，工具调用中间过程通常不存入长期历史，只存最终回复）

---

## 五、多步工具调用

如果模型需要依次调用多个工具，流程会循环执行。

**示例**：用户要求“查天气并提醒带伞”

```
请求1: [固定前缀, 用户输入]
模型1: 返回 tool_calls (get_weather)

请求2: [固定前缀, 用户输入, 模型1的tool_calls, tool结果(天气)]
模型2: 返回 tool_calls (create_reminder)

请求3: [固定前缀, 用户输入, 模型1的tool_calls, 天气结果, 模型2的tool_calls, 提醒结果]
模型3: 返回最终文本回复
```

**关键**：每一步都必须携带**所有历史消息**（包括之前所有的 `assistant`（含 `tool_calls`）和 `tool` 消息），模型才能正确判断当前处于多步工具链的哪个阶段。

---

## 六、缓存机制说明

### 1. 缓存命中条件
- 当前请求的 `messages` 数组的**开头部分**与之前某次请求完全相同。
- 相同部分越长，命中越多。

### 2. 计费规则
- `prompt_cache_hit_tokens`：命中缓存的 token 数，**不计费**。
- `prompt_cache_miss_tokens`：未命中的 token 数，**计费**。

### 3. 最佳实践
- **固定前缀**（system + 规则对）放在最前面，内容绝对稳定。
- **规则更新**采用“追加”方式，而非修改已有消息。
- **对话历史**使用滑动窗口，避免无限增长。
- **工具调用**过程中，固定前缀始终在开头，持续命中缓存。

---

## 七、完整示例（含工具调用 + 缓存优化）

```json
{
  "model": "deepseek-chat",
  "messages": [
    // ========= 固定前缀（命中缓存） =========
    {"role": "system", "content": "你是 INFP 朋友型机器人..."},
    {"role": "user", "content": "【用户偏好】喜欢简洁"},
    {"role": "assistant", "content": "已记录。"},
    {"role": "user", "content": "【纠错】不要说'你肯定很伤心'"},
    {"role": "assistant", "content": "已记录。"},
    
    // ========= 滑动窗口历史 =========
    {"role": "user", "content": "我最近在学吉他"},
    {"role": "assistant", "content": "学吉他很有意思"},
    
    // ========= 当前轮开始 =========
    {"role": "user", "content": "帮我查北京天气，然后提醒我带伞"},
    {"role": "assistant", "content": null, "tool_calls": [{"id": "1", "function": {"name": "get_weather", "arguments": "{\"city\":\"北京\"}"}}]},
    {"role": "tool", "tool_call_id": "1", "content": "晴天，25°C"},
    {"role": "assistant", "content": null, "tool_calls": [{"id": "2", "function": {"name": "create_reminder", "arguments": "{\"content\":\"带伞\"}"}}]},
    {"role": "tool", "tool_call_id": "2", "content": "提醒已创建"}
  ]
}
```

在最后一次请求中，模型会看到完整上下文，生成最终回复，同时固定前缀部分依然命中缓存。

---

## 八、总结

1. **固定前缀**（system + 规则对）放在最前面，保持稳定，最大化缓存命中。
2. **规则更新**采用追加方式，避免破坏前缀连续性。
3. **对话历史**使用滑动窗口，控制 token 长度。
4. **工具调用**时保留完整消息链，确保模型理解多步任务。
5. 通过 `usage.prompt_cache_hit_tokens` 监控缓存命中情况。

按照此规范组织 messages，可在保证模型正确理解上下文的同时，充分利用 DeepSeek 的缓存机制，有效降低延迟和成本。

---

## 九、与 Aris v2 主对话的对应关系

主对话发往模型的 `messages` 在 `packages/server/dialogue/prompt.js` 的 `buildMainDialogueMessages` 中组装，由 `handler.js` 的 `buildPromptContext` 调用。顺序为：

1. **短 system**：`buildStableSystemPrompt()`（人设 + 对话基础规则 + 能力边界说明，不夹会话动态块）。
2. **规则 user/assistant 对**：`buildConstraintRulePairs()`（身份、禁止用语；**用户要求 / 纠错 / 喜好**各一对，或摘要模式下三段各一对），顺序固定；约束分段避免改一项整段失效。
3. **本轮参考（多对消息）**：`buildVolatileContextPairs()` 按**更新频率**从低到高拆成多条 user/assistant：三场景各一对 → 重启恢复 → 相关关联 → 近期小结 → 近期情感 → **状态与时间感（置底，每轮易变）**。改一项只失效该项之后的缓存前缀。
4. **滑动窗口历史**：`buildHistoryMessages(recent)`（真实 `user`/`assistant` 交替，不含最后一条当前用户输入）。
5. **当前用户消息**：`recent` 最后一条。

与本文第二节「纯 system + 规则对 + 历史 + 当前输入」相比，将「每轮都会变」的块从超长 system 中拆到【本轮参考】对中，使 **system + 规则对** 前缀更易在多轮间保持稳定，从而利于 DeepSeek 前缀缓存。Prompt 预览中可查看完整多段 `messages`，并可选对照旧版单条超长 `system` 的等价拼接长度。