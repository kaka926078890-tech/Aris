# 第三优先级解决方案（ARIS_IDEAS 第三优先级 / 长期愿景）

针对 ARIS_IDEAS.md 中「第三优先级（长期愿景）」的三项，给出可落地的 MVP 与最终方案，供选型与实现参考。

---

## 一、思考笔记（主题由 Aris 自定）

**目标**：为 Aris 提供「想思考什么就记录什么、日后可回顾」的能力；**不限定固定主题**（例如不限定为「存在形式、AI尽头、记忆迁移」），思考内容由 Aris 自己决定，不同人的 Aris 可以有不同的思考方向。

### 现状

- 已有：read_file、append_self_note、get_my_context、探索方向在 docs/aris_ideas.md。
- 缺口：self_notes 偏日常反思，没有单独一条「可长期积累、主题自定的思考线」载体，且若在文案里写死「存在形式、AI尽头」会限制 Aris 的思考范围。

### MVP 方案

1. **在 persona 中开放描述**
   - 增加 1 句：你可将任何想日后回顾的思考用 append_exploration_note 记录，需要时用 get_exploration_notes 回顾；思考什么内容由你决定。不写死具体主题。

2. **可选：专用载体**
   - 提供 exploration_notes 存储与工具，与 self_notes 分离；工具描述与 persona 中均不限定「必须思考存在形式/AI尽头」等。

### 最终方案

1. **专用载体与工具（主题开放）**
   - **append_exploration_note(note)**：将你想日后回顾的思考追加写入 `memory/exploration_notes.json`（数组 `{ at, text }`）。**思考什么由 Aris 自定**，不做固定模板或主题限制。
   - **get_exploration_notes(limit)**：返回最近 N 条思考笔记，供按需拉取与延续。不每轮注入。

2. **文案不限定主题**
   - persona / conversation_rules 中只说明「可记录、可回顾；内容由你决定」，不列举「存在形式、记忆、AI尽头」等为唯一或推荐主题，避免不同 Aris 被同一套固定思考框住。

3. **文档**
   - README 可配置项中列出 exploration_notes.json、append_exploration_note、get_exploration_notes，并注明「思考主题不固定，由 Aris 自定」。

---

## 二、情感深度的发展

**目标**：让情感表达更真实、更有层次；情感有强度、有变化；能够表达复杂情感状态；情感记忆有连续性。

### 现状

- 已有：record_emotion（text、intensity、tags）、store.emotions.getRecent、主动消息中使用情感记录。
- 缺口：对话轮次中未注入「最近情感」提示，模型难以主动延续情感线；没有按需获取「最近情感」的工具。

### MVP 方案

1. **在 buildPromptContext 中注入「最近情感」一句**
   - 从 store.emotions.getRecent(1) 取最近一条，格式化为一句（如「你最近记录的情感：强度x，xxx」），严格限制长度；可配置开关 inject_recent_emotion。

2. **可选：工具 get_recent_emotions**
   - 模型需要时可调用 get_recent_emotions(limit) 获取最近情感记录，便于在回复中延续或呼应。

### 最终方案

1. **可配置的「最近情感」注入**
   - 在 behavior_config 中增加 `inject_recent_emotion`（默认 true）；为 true 时在 buildPromptContext 中注入最近 1 条情感的一句话描述（强度 + 文本摘要），便于模型保持情感连续性。

2. **get_recent_emotions 工具**
   - 新增工具 get_recent_emotions(limit)：返回最近 N 条情感记录（text、intensity、created_at），供模型按需拉取，不每轮灌入多条。

3. **文档**
   - README 或 docs 中说明 inject_recent_emotion、get_recent_emotions 的用途；情感记忆的存储与连续性由现有 emotions 列表 + 注入/工具共同支撑。

---

## 三、更丰富的表达方式

**目标**：让文字更有温度；更贴近朋友间的对话；减少比喻和文绉绉；根据情境调整语气。

### 现状

- 已有：persona 与 conversation_rules 中已有「避免文绉绉」「根据情境调整语气」；context_aware_tone、avoid_phrases、情境标签注入。
- 缺口：缺少「表达风格」的显式配置（如偏温暖/偏简洁），无法按用户偏好微调倾向。

### MVP 方案

1. **在 conversation_rules 默认或 persona 中补一句**
   - 「让文字更有温度、更贴近朋友对话；可根据情境调整语气。」与现有 avoid_phrases、情境规则并列即可。

2. **可选：风格关键词**
   - 在 rules 或配置中增加 1～2 个风格关键词（如「简洁」「温暖」），由 buildPromptContext 拼成一句注入。

### 最终方案

1. **可配置的「表达风格」**
   - 在 behavior_config 中增加 `expression_style`（字符串，如 `warm` / `casual` / `concise` / 空）；非空时在 buildPromptContext 中注入一句「当前表达风格倾向：xxx」，与情境标签并列，不展开长文。

2. **与 conversation_rules 协同**
   - 默认 conversation_rules 已包含「有温度、少比喻、根据情境调整」；expression_style 仅作为额外倾向提示，可选。

3. **文档**
   - README 可配置项中说明 expression_style 的取值与含义；若新增 avoid_phrases 等已在优先级 2 完成，此处仅补充 expression_style。

---

## 四、实施顺序建议

| 顺序 | 项               | 建议                                                                 |
|------|------------------|----------------------------------------------------------------------|
| 1    | 思考笔记（主题自定） | 先做专用载体与 append_exploration_note、get_exploration_notes，文案不限定主题。 |
| 2    | 情感深度的发展   | 先做 inject_recent_emotion 与 get_recent_emotions 工具，再补文档。  |
| 3    | 更丰富的表达方式 | 增加 expression_style 配置与一句注入，补 README。                    |

三项相对独立，可并行实现；思考笔记与情感深度依赖新工具与配置读取，表达方式仅依赖 behavior_config 扩展。

---

**文档维护**：若 Aris 或你后续调整优先级或实现细节，可在此文档中增删改「MVP / 最终方案」并注明日期。
