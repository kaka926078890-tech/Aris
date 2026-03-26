# 提示词分层与 messages 组装（最终方案）

## 流程

1. **buildContextDTO**：组装 DTO，含 `avoidPhrasesLine`（常驻）、`constraintsBriefBlock`（`memory/constraints_brief.json` 或截断回退）、`userConstraintsFull`（要求+纠错+喜好全文，不含禁止用语）等。
2. **固定上下文计划**：`prompt.js` 导出 `CHATBOT_CONTEXT_PLAN`（全文用户约束 + 三场景 + 会话小结/关联/状态等块），与旧版「全量注入」体量一致；**无前置编排 LLM**。
3. **buildMainDialogueMessages(dto, plan, recent)**：短 `system`（人设与能力边界）+ 规则类 user/assistant 对 + 本轮易变对 + 滑动历史 + 当前用户。
4. **buildSystemPrompt(dto, plan)**：仍可用于调试「单条大 system」对照（提示词预览中的 legacy 对照区）。

## 双层约束

- **Full**：`requirements` / `corrections` / `preferences` 合并文档（现有 store）。
- **Brief**：`constraints_brief.json`，在纠错/要求/喜好文档合并后 debounce 异步重建（LLM 压缩）；无 key 或失败时用截断回退。**若已有约束长文但摘要文件缺失或三块皆空**，`buildContextDTO` 会在本轮 **await** 先写出一版摘要再读入（避免长期只靠内存里的截断回退、磁盘一直空）。

## conversation_rules.md 可选分段

若需自定义场景块，可在文件中使用：

```markdown
（基础对话规则，常驻 persona）

## 场景特定规则

[SCENE:CODE_OPERATION]
（查代码/文件流程…）

[SCENE:MEMORY_OPERATION]
（记忆路径…）

[SCENE:RESTART]
（重启…）
```

无 `## 场景特定规则` 时，整文件作为基础规则，场景文案用代码内默认。

**注意**：`memory/conversation_rules.md` 常位于实例 `data/` 下（多被 `.gitignore` 排除）。若你本地有该文件，它会**覆盖**代码中的 `BASE_CONVERSATION_RULES`；升级后若仍保留旧版「先检查缓存」等措辞，可能与当前默认（工具在事实/纠错/文件场景须主动调用）不一致，可按需对照 `v2/packages/server/dialogue/prompt.js` 中的默认段自行合并。

## 应用内预览

侧栏 **提示词预览** 会拉取 `getPromptPreview`：展示主对话 **messages**（多段利于前缀缓存），并可选附「单条大 system」对照截断。
