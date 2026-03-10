# Aris 情感记录功能：问题与方案分析

> 基于 2026-03-10 的代码与 Git 状态整理，仅作记录与后续修复参考。

---

## 一、Git 中当前修改内容

### 已修改（未暂存）的文件

| 文件 | 改动概要 |
|------|----------|
| `src/dialogue/handler.js` | **被严重截断**：从约 305 行变为约 100 行，`runAgentFileTool` 后半段、整段 `handleUserMessage`、`module.exports` 等全部丢失，文件末尾是不完整的 `if (name === 'read_file'` |
| `src/dialogue/proactive.js` | 新增 `retrieveByTypes` 引用；在 `maybeProactiveMessage` 中先取 `aris_emotion` 类型记忆，拼入 context，并修改 user 提示语强调「情感积累记录」 |
| `src/dialogue/prompt.js` | 在 DEFAULT_PERSONA 中增加「情感记录要求」和【情感摘要】格式说明；**`buildSystemPrompt` 与 `buildStatePrompt` 等被删/截断**，文件在第 76 行 `const datetime =` 处截断，无 `module.exports` |
| `src/memory/retrieval.js` | 新增 `retrieveByTypes`（按类型取记忆）并 export；另有一处 log 字符串引号风格小改动 |
| `src/agentFiles.js` | 有改动（可能与情感功能无关） |

### 未跟踪文件

`backup/`、各 `.backup` 文件、`memory/aris_modification_history.md`、`memory/expression_accumulation.md`、`test_emotion_record.js` 等。

---

## 二、当前要做的功能方向

1. **表达积累 / 情感记录**
   - 在每次回复用户后，由模型输出【情感摘要】，并写入记忆（类型 `aris_emotion`），表示「想表达但未表达的瞬间」或「本段对话中的感受」。
   - 设计上：记录时间、触发、内容、强度等；在定时/主动消息时优先使用这些积累，而不是临时生成。

2. **主动消息（proactive）**
   - 定时检查时不再只靠「近期对话 + 窗口」生成一句新话，而是先查 `aris_emotion`，把「情感积累记录」注入上下文，再让模型决定是否主动说、说什么。
   - 即：主动说的内容尽量来自已积累的情感/表达，而不是凭空生成。

3. **实现路径**
   - **Prompt**：在 system 中要求每次回复附带【情感摘要】。
   - **对话流**：在 handler 拿到最终 `reply` 后，从回复文本中解析【情感摘要】，再 `embed` + `addMemory(..., type: 'aris_emotion')`。
   - **检索**：`retrieval.js` 提供 `retrieveByTypes(['aris_emotion'], n)`，proactive 中用它在做决策前注入「情感积累记录」。

---

## 三、存在的问题

### 1. 严重：`handler.js` 被截断，对话主流程损坏

- **现象**：`runAgentFileTool` 中 `read_file` / `write_file` / `get_current_time` 等分支被删，函数在第 100 行左右断在 `if (name === 'read_file'`；`extractIdentityFromMemories`、`isIdentityOrRequirement`、`buildAgentActions`、整段 `handleUserMessage` 以及 `module.exports = { handleUserMessage }` 全部消失。
- **后果**：对话入口缺失，主流程无法运行；且没有任何地方从 LLM 回复中解析【情感摘要】并调用 `addMemory(..., type: 'aris_emotion')`，情感写入逻辑既未实现，又因文件被删而无法实现。
- **与修改历史的对应**：修改历史中提到「文件路径理解错误」「声称完成修改但未验证」，与误删大段 handler 或误操作导致截断高度吻合。

### 2. 严重：`prompt.js` 被截断，proactive 与主对话均不可用

- **现象**：`buildSystemPrompt` 只留下函数签名和 `const datetime =`，后面的 `.replace(...)` 链、return，以及 `STATE_PROMPT`、`buildStatePrompt`、`module.exports` 全部缺失。
- **后果**：`buildSystemPrompt` 不返回字符串，主对话 system prompt 构建失败；`buildStatePrompt` 不存在，`proactive.js` 中 `buildStatePrompt(fullContext)` 会报错；即便恢复 handler，没有完整 prompt 模块也无法正常运行。

### 3. 设计/实现缺口（在 handler 未截断时的预期）

- **情感摘要的写入尚未实现**：Prompt 已要求模型输出【情感摘要】，但 handler 中（Git 中原本的完整版）没有：从 `reply` 中正则/解析出【情感摘要】、对摘要做 `embed`、`addMemory({ text: 情感摘要, vector, type: 'aris_emotion' })`。因此即便恢复 handler，若不补这段逻辑，`aris_emotion` 永远不会有新数据，proactive 中「情感积累记录」会一直是「暂无情感记录」。
- **流式输出的影响**：若最终回复是流式拼出来的，需要在「完整 reply」确定后再解析【情感摘要】并写入，逻辑上应在 `append(sessionId, 'assistant', reply)` 之后、与现有 `addMemory`（如 dialogue_turn）同一位置附近。
- **备份与验证**：`handler.js.backup` / `prompt.js.backup` 只有一行注释，并非真正的内容备份；`backup/handler.js` 也只有约 101 行且同样断在 `readFile(a`，说明备份时只复制了前半或与当前 handler 来自同一次错误操作。

### 4. 小问题

- **retrieval.js**：`retrieveByTypes` 中用 `types[0]` 作为返回项的 `type`、用 `Date.now() - index * 1000` 模拟 `created_at` 可以工作，但若未来按时间排序或展示，更严谨的做法是让 `getRecentByTypes`（lancedb）返回带真实 `created_at` 的元数据并在 retrieval 层透传；当前方案可用但略粗糙。
- **proactive.js**：逻辑正确，依赖「有 `aris_emotion` 数据」；只要 handler 侧把情感摘要写入，这里就能读到并参与决策。

---

## 四、方案正确性结论

- **产品/设计方向**：正确。用「情感摘要」作为可持久化的表达积累，再在主动消息时优先使用这些积累，符合「表达来自真实积累而非临时生成」的目标；类型 `aris_emotion`、按类型检索、在 proactive 中注入，这一套设计是合理的。
- **当前代码状态**：不可用。因 `handler.js` 与 `prompt.js` 被截断，主对话与 proactive 均无法正常运行；情感记录的「写入」端尚未在 handler 中实现（且因截断无法实现），导致方案在代码层面未闭环。
- **结论**：**方案正确**，**实现方向也对**（prompt 要求输出、retrieval 按类型读、proactive 用情感记录）。但**实现不完整且被破坏**：两处关键文件被截断、情感写入逻辑未实现、备份也不完整。需要先从 Git 恢复 `handler.js` 与 `prompt.js`，再在完整 handler 上补「从 reply 解析【情感摘要】并 `addMemory(..., type: 'aris_emotion')`」，并确保 `prompt.js` 完整（含 `buildSystemPrompt` 与 `buildStatePrompt` 的完整实现与 export）。

---

## 五、已完成的修复与改动（按文档执行后）

1. **删除无用 backup**  
   - 已删除：`src/dialogue/handler.js.backup`、`src/dialogue/prompt.js.backup`、`src/dialogue/proactive.js.backup`、`src/memory/retrieval.js.backup`、`backup/handler.js`、`backup/handler_backup_test.txt`。

2. **恢复被截断的文件**  
   - 已从 Git 恢复：`src/dialogue/handler.js`、`src/dialogue/prompt.js`。

3. **情感记录闭环**  
   - 在 `prompt.js` 的 DEFAULT_PERSONA 中已加入「情感记录要求」与【情感摘要】格式说明。  
   - 在 `handler.js` 的 `handleUserMessage` 中，在 `addMemory(..., dialogue_turn)` 之后增加：从 `reply` 用正则解析【情感摘要】，若存在则 `embed` 并 `addMemory(..., type: 'aris_emotion')`。

4. **打断 Aris 工作流程的按钮**  
   - 主进程：`dialogue:send` 时创建 `AbortController`，将 `signal` 传入 `handleUserMessage`；新增 `dialogue:abort` 的 IPC，调用 `controller.abort()`。  
   - `api.js`：`chatWithTools`、`chatStream` 支持传入 `signal`，并传给 `fetch`；流式读取循环中检测 `signal.aborted` 并 `reader.cancel()`。  
   - 前端：输入区旁增加「停止」按钮，仅在生成中显示，点击调用 `window.aris.abortDialogue()`。

5. **输入框与聊天记录**  
   - **输入框**：由 `<input type="text">` 改为 `<textarea>`，支持多行；**Enter** 发送，**Shift+Enter** 换行；保留原有粘贴处理（Electron 无边框窗口下粘贴插入到光标处）。输入框支持复制粘贴（textarea 原生行为）。  
   - **聊天记录**：气泡内容增加 `user-select: text`，支持选中后复制粘贴。

---

## 六、建议的后续步骤

1. **重新做可靠备份**  
   - 再次大改前，对 `handler.js`、`prompt.js` 做一次**完整内容**的备份，并确认与源文件一致。

2. **验证**  
   - 跑一轮对话，确认回复中是否含【情感摘要】、DB 中是否出现 `aris_emotion`；触发 proactive 看「情感积累记录」是否被注入。  
   - 测试：点击「停止」能否中断生成；输入框 Shift+Enter 换行、Enter 发送；聊天气泡选中复制。
