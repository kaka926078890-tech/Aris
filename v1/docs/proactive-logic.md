# Aris 主动发话逻辑说明

## 1. 当前流程概览

```
主进程启动
    → startProactiveInterval()（每 3 分钟执行一次）
        → maybeProactiveMessage()
            → 拼上下文（近期 10 条对话 + 当前窗口标题 + 检索到的相关记忆）
            → 调用 LLM（buildStatePrompt + 一条固定 user 消息）
            → LLM 返回一整段文本，包含：
                - 情绪与想法：...
                - 是否想说话：是/否
                - 若想说话，内容：...
            → 若为「否」或解析失败 → return null，不发话
            → 若为「是」且解析出 5～200 字的一句话 → 写入对话、写入记忆、return 这句话
        → 若返回值非空 → mainWindow.webContents.send('aris:proactive', msg)
    → 渲染层收到 aris:proactive → 把 msg 当作一条助手气泡展示
```

- **触发方式**：**定时器**，每 **3 分钟** 执行一次（`electron.main.js` 里 `setInterval(..., 3 * 60 * 1000)`），没有“空闲 N 分钟再问”之类的规则，到点就调一次。
- **是否发话、说什么**：完全由 **LLM 根据当前上下文** 决定；上下文 = 近期对话 + 窗口标题 + 向量检索到的相关记忆。
- **思考过程**：LLM 返回的整段（情绪与想法 + 是否想说话 + 内容）只在 `proactive.js` 里用于解析，**没有** 给用户看；前端只收到最后那句「若想说话，内容」并当作一条普通消息展示。

## 2. 涉及文件

| 文件 | 作用 |
|------|------|
| `electron.main.js` | `startProactiveInterval()`：每 3 分钟调一次 `maybeProactiveMessage()`；有返回值时 `send('aris:proactive', msg)` |
| `src/dialogue/proactive.js` | `maybeProactiveMessage()`：拼上下文、调 LLM、解析「是否想说话」和「内容」、落库、返回要发的那句话 |
| `src/dialogue/prompt.js` | `buildStatePrompt()`：系统提示词，要求模型输出「情绪与想法 / 是否想说话 / 若想说话，内容」的固定格式 |
| `preload.js` | 暴露 `onProactive(callback)`，监听 `aris:proactive` |
| `src/renderer/main.js` | `window.aris.onProactive`：收到后 `addBubble('assistant', msg)` 并显示对话层 |

## 3. 如何看到「思考过程」

当前实现里，**模型返回的「情绪与想法」和「是否想说话」没有对用户可见的展示**，只有解析出的那一句话会发到前端。

若你想看到思考过程，可以：

1. **看控制台**：在 `proactive.js` 里把 LLM 的完整回复打 log（见下节），在终端/控制台里能看到每次的「情绪与想法」和是否发话、内容。
2. **在 UI 里展示**：在主进程里除了 `aris:proactive` 的 `msg`，再发一段「思考摘要」（例如从完整回复里截取的「情绪与想法」），前端在展示气泡时同时显示「Aris 在想：xxx」或单独一块区域显示最近一次主动发话的思考。

下面在 `proactive.js` 里加了一段日志：每次主动发话前会打印 LLM 的完整回复（情绪与想法、是否想说话、内容），在**运行应用时的终端/控制台**里搜索 `[Aris][proactive] 思考过程` 即可看到。

- 定时器间隔在 `electron.main.js` 的 `startProactiveInterval()` 里，当前为 `3 * 60 * 1000`（3 分钟），可按需修改。
