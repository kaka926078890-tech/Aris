# 提示词分层与 Prompt Planner（最终方案）

## 流程

1. **buildContextDTO**：组装 DTO，含 `avoidPhrasesLine`（常驻）、`constraintsBriefBlock`（`memory/constraints_brief.json` 或截断回退）、`userConstraintsFull`（要求+纠错+喜好全文，不含禁止用语）、`recentWindowForPlanner` 等。
2. **runPromptPlanner**（可关）：前置 LLM 根据**当前用户消息 + 极短对话节选 + brief** 输出 JSON：`scenes`、`need_full_constraints`、`need_session_summary`、`need_related_associations`、`need_last_state`、`risk_level`。不用关键词硬编码。节选仅为减冗：主对话 system 仍含【当前会话最近几轮】全量（与 `handler` 拉取的 `recent` 一致），编排模型说明中已注明勿因节选较短而假定主模型看不到更早内容。
3. **buildSystemPrompt(dto, plan)**：按 plan 拼接上下文块；`scenes` 决定注入哪些场景规则（查代码/记忆路径/重启）。
4. **关闭 Planner**：`ARIS_PROMPT_PLANNER_ENABLED=false` 或 `behavior_config.json` 中 `prompt_planner_enabled: false` 时，使用 **LEGACY_PLAN**（全文约束 + 三场景 + 全块），与旧版体量接近。

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

## 评估

- 设置 `ARIS_PROMPT_PLANNER_LOG=true` 或 `behavior_config.json` 中 `prompt_planner_log_metrics: true`，会在数据目录写入 `prompt_planner_metrics.jsonl`（每行含 `plan`、`planner_error`、`system_chars`）。

## 应用内预览

侧栏 **提示词预览** 会拉取 `getPromptPreview`：分两块展示 **① Prompt Planner（编排 LLM）**（发给编排模型的 system/user、assistant 原始返回、生效 plan）与 **② 主对话**（主模型 system + user）。每块标题栏有复制图标，可单独拷贝。
