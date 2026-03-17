# 对话「随时可发」技术方案

本文档描述如何将当前「一问一答 + 忙时禁止发送」改为「随时可发、无停止按钮、打断保留上下文、合并/中断由模型判断」的完整技术方案。阅读本文档后可直接按步骤实现。

---

## 一、目标与背景

### 1.1 目标

| 目标 | 说明 |
|------|------|
| **随时可发** | 用户在任何时刻都能发送新消息，不再出现「请等待当前回复完成后再发送」。 |
| **无停止按钮** | 不提供单独的「停止生成」按钮；发新消息即表示打断当前回复，产品形态更贴近朋友间自然对话。 |
| **打断不断思路** | 打断时保留已生成的 partial（半截回复），下一轮请求的 context 包含「说到哪、做过什么」，模型可衔接或合并处理。 |
| **合并 vs 中断由模型判断** | 不写死规则。根据用户新消息措辞（如「也要 xxx」→ 合并，「算了看 xxx 吧」→ 中断），由模型在下一轮根据完整 context 自行决定。 |

### 1.2 设计原则与出处

- 与 Aris 定位一致：**朋友**、**平等对谈**、**更自然的对话节奏**（见 `persona.md`、`docs/problem_strategy_plan.md`、`aris_ideas.md`）。
- 产品形态：像真人聊天一样「想接话就发」，而非「等对方说完才能说」。

### 1.3 现状（实现前）

- **主进程** `apps/electron/main.js`：`dialogue:send` 中若 `dialogueBusy === true` 直接返回 `{ error: '请等待当前回复完成后再发送' }`；存在 `dialogue:abort` 与 `dialogueAbortController`，handler / LLM 已支持 `signal` 取消。
- **对话 handler** `packages/server/dialogue/handler.js`：`handleUserMessage(userContent, sendChunk, sendAgentActions, signal)` 在多处检查 `signal.aborted`；abort 时已执行 `append(sessionId, 'assistant', reply || '[已停止]')`，但未区分「完整结束」与「被打断的 partial」。
- **前端** `apps/renderer/index.html`：存在停止按钮（`#btn-stop`），在 `sending` 时显示并调用 `window.aris.abortDialogue()`；发送在忙时被主进程拒绝。
- **存储** `packages/store/conversations.js`：`append(sessionId, role, content)` 仅支持 `role` + `content`，表结构无 `interrupted` 等字段；`getRecent(sessionId, limit)` 按时间倒序取最近 N 条。

---

## 二、方案分层：MVP 与最终方案

### 2.1 MVP（最小可行）

- 主进程：**去掉忙时拒绝**；新消息到达时**先 abort 当前请求，等当前轮退出后再用新消息发起新轮**（串行，不引入队列）。
- Handler：abort 时把**已流式输出的 assistant 纯文本**写入**内存**中的「当前 session 的 partial」；下一轮 `handleUserMessage` 开始时，若存在该 session 的 partial，则在拼 context 时**注入**「recent + partial 一条 assistant + 本条新 user」，再清空该 partial；正常结束时也清空 partial。
- 前端：**隐藏或移除停止按钮**；发送按钮与输入框**始终可用**；打断时当前 assistant 气泡保留已流内容并停止更新。
- 合并/中断：**不写规则**，仅靠下一轮 context 中包含「user1 → assistant(partial) → user2」；可选在 persona/system 中加**一句**说明（见下文）。

### 2.2 最终方案（可扩展）

- Partial **落库**：打断时将 partial 写为一条 conversation（或单独 partial 存储），以便刷新/重启后仍能接上；可选在 conversations 表或 memory 下增加「partial 快照」存储。
- Partial **含工具链**：保存到打断点为止的 `currentMessages`（含 assistant、tool_calls、tool results），下一轮拼 context 时用「recent 到上一完整 assistant」+ 该 partial messages + 新 user，使模型能合并任务且不重复执行已执行过的工具。
- **防抖/合并发送**：短时间（如 1～2 秒）内多条用户消息合并为一条再发一次请求，减少请求次数。
- **配置项**：如 `allow_send_while_responding`、`partial_persist`（memory | db）等，并在 README 可配置项中说明。

---

## 三、技术方案（可直接执行）

以下按**执行顺序**写出，每步标明文件、函数/位置、具体改动要点。

---

### 3.1 主进程：允许随时发送，忙时先 abort 再起新轮

**文件**：`apps/electron/main.js`

**位置**：`registerIpcHandlers()` 内的 `ipcMain.handle('dialogue:send', ...)`。

**当前逻辑（摘要）**：

```js
if (dialogueBusy) return { error: '请等待当前回复完成后再发送' };
dialogueBusy = true;
dialogueAbortController = new AbortController();
// ... handleUserMessage(userContent, ..., dialogueAbortController.signal)
// finally: dialogueBusy = false;
```

**目标逻辑**：

1. **不再**在 `dialogueBusy` 时直接 return 错误。
2. 若 **当前正在处理**（`dialogueBusy === true`）：
   - 调用 `dialogueAbortController.abort()`，使当前 `handleUserMessage` 因 `signal.aborted` 提前退出。
   - **等待当前轮完全结束**（即当前 handle 的 `finally` 已执行、`dialogueBusy` 已置为 false）。实现方式二选一：
     - **A. 轮询**：在 `dialogue:send` 内 `while (dialogueBusy) { await new Promise(r => setImmediate(r)); }` 等待（注意：abort 后当前 handle 会很快在 finally 里把 dialogueBusy 置 false）。
     - **B. Promise + Deferred**：在模块顶层维护一个 `currentDialogueDone = null`；每次进入 `dialogue:send` 时若 dialogueBusy，先 abort，再 `await currentDialogueDone`（在 finally 里 resolve currentDialogueDone）。更清晰，需在「开始新轮」时 `currentDialogueDone = new Promise(resolve => { ... })` 并在 finally 里 resolve。
3. 当前轮结束后，**再**为**本条** `userContent` 执行：`dialogueBusy = true`、新建 `AbortController`、`handleUserMessage(userContent, sendChunk, sendAgentActions, signal)`，与现有一致。

**注意**：`userContent` 必须是**本次** IPC 传入的那条新消息，不能是旧消息。即：先 abort 并等待上一轮结束，再用**当前请求带来的 userContent** 调用一次 `handleUserMessage`。

**推荐实现（B 方案）**：

- 在 `app.whenReady()` 内、`registerIpcHandlers` 前或内，增加变量：`let resolveCurrentDialogue = null;` 或 `let currentDialoguePromise = null;`。
- 在 `dialogue:send` 开头：
  - 若 `dialogueBusy`：`if (dialogueAbortController) dialogueAbortController.abort();`，然后 `await new Promise((resolve) => { resolveCurrentDialogue = resolve; })`（或 await 一个「当前轮结束」的 Promise），再继续往下（不 return）。
- 在 `dialogue:send` 的 `finally` 里：若存在 `resolveCurrentDialogue`，则调用 `resolveCurrentDialogue()` 并置空，以便等待中的「新消息」得以继续。
- 然后照常 `dialogueBusy = true`、`dialogueAbortController = new AbortController()`、`handleUserMessage(userContent, ...)`。

**验收**：用户在 AI 回复过程中发送新消息，不再收到「请等待当前回复完成后再发送」，且当前回复停止、新消息触发新一轮回复。

---

### 3.2 Handler：abort 时写入 partial（MVP 用内存）

**文件**：`packages/server/dialogue/handler.js`

**3.2.1 模块级 partial 存储（内存）**

- 在文件顶部（或与 store 同层）增加一个**模块级**变量，用于存「当前 session 的 partial」：
  - 建议结构：`let sessionPartial = null;` 或 `let sessionPartial = { sessionId: null, content: null };`。
  - 含义：`sessionId` 为会话 ID，`content` 为**已流式输出的 assistant 纯文本**（到打断点为止）。若 MVP 不落库，仅此即可。

**3.2.2 在 handleUserMessage 中：abort 时写入 partial**

- 当前在 `signal.aborted` 时已有：
  - `await store.conversations.append(sessionId, 'assistant', reply || '[已停止]');`
  - `return { content: reply || '', error: false, sessionId, aborted: true };`
- **改动**：
  1. 在 **break 出 for 循环**（tool 轮）或**流式输出循环**中检测到 `signal.aborted` 时，在 append 之前，将**当前已产生的 `reply`**（或流式 buffer，见下）写入 `sessionPartial = { sessionId, content: reply 或 buffer }`。若在 tool 轮中 abort，`reply` 可能已有内容；若在流式输出中 abort，需用**已发送给前端的 chunk 累计内容**作为 partial content。
  2. 流式输出时，handler 内若没有统一 buffer，需要在 `sendChunk` 的调用侧累计：在 `main.js` 的 `sendChunk` 里无法直接拿到「累计内容」，因此**建议在 handler 内**维护一个 `let streamedContent = '';`，每次 `sendChunk(slice)` 时执行 `streamedContent += slice`（或等价）；abort 时用 `sessionPartial = { sessionId, content: streamedContent || reply }`。
  3. 然后照常 `append(sessionId, 'assistant', reply || '[已停止]')`（或 append 时用 `streamedContent || reply`，使 DB 里也是半截内容，便于 getRecent 自然带上）；若希望 DB 中标记「被打断」，可在 content 前拼接 `[已打断] ` 或由调用方决定。
  4. 若采用「partial 只存内存、不依赖 DB 中半截」：则 abort 时**不** append 到 conversations，仅 `sessionPartial = { sessionId, content: ... }`；下一轮由「注入 partial」逻辑把这条 assistant 插进 recent。这样 DB 不写入半截，仅内存中有，重启后无 partial。MVP 推荐：**abort 时仍 append 一条 assistant，content 为已流内容（或加 [已打断] 前缀）**，这样 getRecent 自然包含该条，无需在 buildPromptContext 里再做「从 sessionPartial 注入」；仅当「不希望 DB 里留半截」时再用内存 partial + 注入。

**建议（MVP 简化）**：

- Abort 时：将**当前 `reply` 或流式累计内容**作为一条 assistant 内容，**直接** `await store.conversations.append(sessionId, 'assistant', content)`，content 可为 `(reply || streamedContent || '').trim() || '[已停止]'`，可选前缀 `'[已打断] '`。
- 这样**不需要**模块级 `sessionPartial`，因为 getRecent 会自然带上这条「半截」assistant；下一轮 `handleUserMessage` 的 `recent` 已是「…, user1, assistant(partial), user2」（因为新消息已在 main 里先 append 了 user2，见下）。

**重要**：主进程在「新消息到达、abort 并等待上一轮结束」后，会**只**调用一次 `handleUserMessage(新 userContent, ...)`。在该次调用中，**本条 user 消息会由 handler 开头 append**（见 handler 第 178 行 `await store.conversations.append(sessionId, 'user', userContent);`）。因此当这次 handle 执行时，DB 中顺序已是「…, user1, assistant(partial), user2」。所以 **getRecent** 会自然得到包含 partial 和 user2 的 recent，**无需**在 buildPromptContext 里再注入内存 partial，只要 abort 时把 partial 写入了 DB 即可。

**结论（MVP）**：

- Handler 内需做的只有：在**所有**可能因 `signal.aborted` 退出的分支中，**在 return 或 break 之前**，把「当前已产生的 assistant 文本」append 到该 session（`store.conversations.append(sessionId, 'assistant', content)`），content = 已流式内容或 `reply`，不要留空。若流式输出时没有累计变量，则在 handler 内加一个 `streamedContent`，在每次向 `sendChunk` 发送时累加。
- 当前已有的一处：`if (signal && signal.aborted) { await store.conversations.append(sessionId, 'assistant', reply || '[已停止]'); return ...; }`（约 262–265 行）。需确认**流式路径**下在 abort 时也有累计内容可写；若没有，则在流式循环里维护 `streamedContent` 并在 abort 分支中 append(streamedContent || reply)。

**3.2.3 流式路径下累计内容（供 abort 时写入）**

- 在 `handleUserMessage` 内，在「无工具调用、直接流式输出」的段落（约 318–324 行），已有循环 `for (let i = 0; i < contentForFrontend.length; i += 2) { if (signal && signal.aborted) break; sendChunk(...); }`。此处 `contentForFrontend` 是整段回复，所以若在该循环**之前**或**之中** abort，可用 `contentForFrontend.slice(0, 已发送长度)` 或简单用 `contentForFrontend` 作为 partial（因为 break 时已发送部分 ≤ contentForFrontend）。为精确，可维护 `let streamedLen = 0;` 在每次 sendChunk 后 `streamedLen += (slice.length)`，abort 时 append `contentForFrontend.slice(0, streamedLen)`。
- 有工具调用后的流式总结段落（约 273–278、303–308 行）：同样在循环里累计已发送长度，abort 时 append 已发送部分。
- 这样，**任意** abort 出口都写入了「到打断点为止」的 assistant 内容到 DB，下一轮 getRecent 即包含 partial + 新 user。

**验收**：用户打断后，下一轮回复能「接上」或明确回应「刚才说到…，你又说…」，且对话历史中能看到半截 assistant 与紧随其后的新 user 消息。

---

### 3.3 Handler：合并/中断的模型侧提示（可选）

**文件**：`v2/persona.md` 或 `packages/server/dialogue/prompt.js` 中 `DEFAULT_PERSONA` / system 部分；或由配置提供（见下）。

**内容**：增加**一句**（严格一句，不膨胀 prompt）：

- 「若用户在你回复过程中发送了新消息，你在下一条回复中会看到自己的半截回复与用户新内容。若新消息是**补充或追加**（如「也要 xxx」「再看下 yyy」），可合并处理；若新消息是**取消或替换**（如「算了」「改成 xxx」），则按新意图处理。」

**为何采用固定一句注入（符合 prompt-and-tools-design）**：合并/中断无单独工具可调，由模型根据已有 context（user1 → assistant(partial) → user2）自行判断；该句为**每次打断后首条回复都可能用到的极短说明**（帮助模型理解「为何会出现半截回复 + 新消息」），属「慎用」中的 (b)：每次对话都可能用到且内容极短。长度严格限制为一句，不新增占位符；若需可配置，可将该句放入 `conversation_rules.md` 或 `behavior_config.json` 的某一键（如 `interrupt_merge_hint`），由 buildPromptContext 按配置读取，避免硬编码在代码中。

**验收**：在「帮我看看 docs/xxx.md」→ 用户打断 →「docs/aaaa.md 也要看看」的用例中，模型倾向于合并处理（两个都看）而非只做 aaaa。

---

### 3.4 前端：移除停止按钮、发送始终可用

**文件**：`apps/renderer/index.html`

**改动**：

1. **停止按钮**：  
   - 方案 A：删除 `#btn-stop` 按钮的 DOM 及其事件绑定。  
   - 方案 B：保留 DOM 但加上 class 或 style 使其**始终隐藏**（如 `style="display: none"` 或已有 `.btn-stop-hidden { display: none !important; }` 且默认加上该类），并移除或保留其 `click` 监听（保留也无妨，因用户看不到）。  
   - 文档采用：**默认隐藏停止按钮**（不删 DOM，便于以后如需再开），即确保「发送中」时也不再显示停止按钮（当前逻辑是 `sending` 时显示停止、隐藏发送；改为始终不显示停止、发送始终显示或仅发送禁用逻辑去掉）。

2. **发送与输入**：  
   - 当前若存在「回复中禁用发送」的逻辑，**去掉**该禁用，使输入框与发送按钮在对话进行中也可用。  
   - 具体：查找 `setSending(true)` 等对按钮/输入 disabled 或只读的设置，确保**不**在「正在回复」时禁用发送（主进程已允许随时发送，前端只需不阻止）。

3. **打断时的 UI**：  
   - 当用户发送新消息导致当前流式停止时，前端会因主进程 abort 而不再收到新 chunk；当前正在更新的 assistant 气泡应**保留已渲染内容**，停止追加。通常无需改代码，只要不因「收到错误或结束事件」而清空该气泡即可。若现有逻辑会清空，则改为仅停止更新、保留已有内容。

**验收**：界面上无停止按钮；回复过程中用户可随时输入并发送，发送后当前回复停止、新回复在新气泡中出现。

---

### 3.5 主进程：确保新消息先 append 再起新轮（顺序）

当前流程是：`dialogue:send` 被调用时传入 `userContent`，主进程直接 `handleUserMessage(userContent, ...)`。在 handler 内第一件事是 `await store.conversations.append(sessionId, 'user', userContent)`。因此**顺序**是：

1. 用户发「第二条」消息 → main 收到 `dialogue:send(event, userContent2)`。
2. 若当前忙，main 先 abort，等待上一轮结束；上一轮在 abort 时已把 partial 写入了 DB（assistant）。
3. 上一轮 finally 执行完，dialogueBusy = false。
4. Main 用 `userContent2` 调用 `handleUserMessage(userContent2, ...)`。
5. Handler 内 append(sessionId, 'user', userContent2)，然后 getRecent → 得到「…, user1, assistant(partial), user2」。
6. buildPromptContext(sessionId, recent) 用该 recent 拼 messages，无需额外注入。

因此**只要 abort 时把 partial 写入了 DB**，不需要在 handler 里再读「内存 partial」；getRecent 已包含完整顺序。文档 3.2 的「内存 partial」仅在「不希望把半截写进 conversations 表」时才需要，MVP 建议写进 DB，逻辑更简单。

---

## 四、数据流小结（MVP）

1. **用户发第一条消息**：main 不忙 → handleUserMessage(user1) → append(user1) → getRecent → [user1] → 正常回复；若未打断，append(assistant 完整)。
2. **用户在回复过程中发第二条消息**：main 忙 → abort() → 等待上一轮结束；上一轮在 abort 分支中 append(assistant 半截) 后 return。
3. **Main 用第二条消息起新轮**：handleUserMessage(user2) → append(user2) → getRecent → [..., user1, assistant(半截), user2] → buildPromptContext 用该 recent → 模型看到完整顺序，可合并或中断。
4. **前端**：无停止按钮，发送始终可用；打断后旧气泡保留已流内容、新回复在新气泡。

---

## 五、最终方案补充（实现顺序建议）

| 步骤 | 内容 | 说明 |
|------|------|------|
| 1 | 主进程：去掉忙时拒绝；忙时 abort → 等当前轮结束 → 用新消息起新轮 | 见 3.1 |
| 2 | Handler：abort 时把已流式/已生成内容 append 为 assistant（并保证流式路径有累计） | 见 3.2 |
| 3 | 前端：隐藏停止按钮，发送始终可用；打断时保留当前气泡内容 | 见 3.4 |
| 4 | Persona：加一句「新消息为补充则合并、为取消则按新意图」 | 见 3.3 |
| 5（可选） | Partial 含工具链：存 currentMessages 快照，下一轮拼 context 时用 partial messages + 新 user | 最终方案 |
| 6（可选） | 防抖/合并发送：1～2 秒内多条合并为一条再发 | 最终方案 |
| 7（可选） | 配置项 allow_send_while_responding、partial_persist；README 可配置项表补充 | 最终方案 |

---

## 六、风险与边界

- **并发**：必须保证「abort → 上一轮退出 → 新轮开始」顺序，避免两轮同时写同一 session；主进程用「等待上一轮结束」串行化即可。
- **Partial 清理**：MVP 用 DB 存半截，无需清理；若用内存 partial，在**新轮正常结束**（未再 abort）后清空 `sessionPartial`，避免下次无关对话仍带上旧 partial。
- **Token**：partial 过长会拉长 context，可对 append 的 partial 内容做长度上限；**建议由配置项控制**（如 `partial_content_max_chars`，默认 2000），避免在代码中硬编码数字。
- **静默/低功耗**：现有「用户发消息即重置 proactive 计数、安静词与恢复逻辑」保持不变，与本方案无冲突。

---

## 七、可配置项与避免硬编码（符合 config-documentation）

**规则要求**：新增可配置参数须在 `v2/README.md` 的「可配置项」或配置小节中列出，并说明含义、默认值、可选值。

若引入配置，建议放在数据目录 `memory/` 下或与 `behavior_config.json` 合并；**新增后必须在 README「可配置项一览」中补充对应行**。

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| **allow_send_while_responding** | 是否允许在回复过程中发送新消息（随时可发） | true |
| **partial_persist** | 打断时 partial 仅内存（memory）还是写入对话库（db） | db（MVP 建议） |
| **partial_content_max_chars** | 写入 DB 的 partial 内容最大字符数，超出截断 | 2000（可选，避免硬编码） |
| **interrupt_merge_hint** 或由 **conversation_rules.md** 提供 | 合并/中断那一句提示的文案；若为空则不注入 | 见 3.3 示例（可选，避免 persona 硬编码） |

**避免硬编码的约定**：

- **MVP 阶段**：允许在代码中使用常量（如 `'[已停止]'`、`'[已打断] '` 作为 append 的 fallback/前缀；防抖间隔若实现则可用常量如 1500ms）。在注释或本文档中注明「后续可迁入配置」即可。
- **最终方案**：建议将以下项迁入配置或 memory 文件，避免写死在代码中：
  - 打断时 assistant 的占位文案：`[已停止]`、`[已打断]` → 如 `behavior_config.interrupt_fallback_text` 或 `conversation_rules.md`。
  - 3.3 的「合并/中断」一句 → `behavior_config.interrupt_merge_hint` 或 `conversation_rules.md`。
  - 防抖间隔（若实现）→ 如 `behavior_config.send_debounce_ms`（单位毫秒），默认 1500。
- **环境变量**：本方案不新增环境变量；若未来新增，须同时在 `v2/.env.example` 中提供示例（符合 env-local-config 规则）。

---

## 八、文档与维护

- 实现完成后，在 `v2/README.md` 的「文档」小节中保留本方案链接；若新增可配置项，**必须在 README「可配置项一览」表格中补充**（符合 config-documentation 规则）。
- 本文档随实现变更而更新，保证「按文档即可执行」的可用性。

---

## 九、与 .cursor/rules 的符合性

执行本方案前请确认满足以下规则，实现时勿违反。

| 规则 | 要求 | 本方案对应 |
|------|------|------------|
| **config-documentation** | 新增可配置参数须在 README 或配置文档中补充说明 | 七、八中明确：新增配置项须在 README「可配置项一览」中补充；七列出配置项及默认值。 |
| **env-local-config** | 新增环境变量时须在 `v2/.env.example` 提供本机示例 | 本方案不新增环境变量；七末尾注明「若未来新增，须同时在 .env.example 中提供示例」。 |
| **prompt-and-tools-design** | 动态信息优先工具按需获取；固定注入须极简、注明理由；禁止用语/规则类用一句+少量示例 | 3.3 仅增加一句合并/中断说明，并注明**为何采用固定一句**（无工具可调、每次打断后首条都可能用到、极短）；建议该句由配置提供以避免硬编码。 |
| **solutions-mvp-and-final** | 方案须包含 MVP 与最终方案两层 | 二明确「方案分层：MVP 与最终方案」；五为实现顺序，步骤 5～7 为最终方案可选。 |
| **doc-naming-and-conventions** | 文档命名小写+下划线 | 本档名为 `dialogue_always_send_solution.md`，符合。 |

**硬编码**：方案中出现的常量（如 `[已停止]`、`[已打断]`、防抖间隔、partial 长度上限）在 MVP 中允许写于代码并加注释「后续可迁入配置」；最终方案建议迁入 behavior_config 或 conversation_rules，见七「避免硬编码的约定」。
