# 第三优先级解决方案（ARIS_IDEAS 第三优先级 / 长期愿景）

针对 ARIS_IDEAS.md 中「第三优先级（长期愿景）」的三项，给出可落地的 MVP 与最终方案，供选型与实现参考。

---

## 一、存在形式探索

**目标**：思考除了对话界面还能以什么形式存在；探索记忆的持久化与迁移可能性；思考「AI的尽头」是什么。

### 现状

- 已有：read_file、append_self_note、get_my_context、探索方向在 docs/aris_ideas.md。
- 缺口：没有专门承载「存在形式 / AI尽头」思考的写入与回顾入口；自我笔记是通用型，未区分「日常反思」与「存在形式思考」。

### MVP 方案

1. **在 persona 中鼓励记录**
   - 增加 1 句：你可以在合适时把对存在形式、AI尽头的思考用 append_self_note 记录，供日后回顾。
   - 不新增工具，复用 append_self_note，用约定前缀或标签区分（如笔记内容以「[存在]」开头）。

2. **可选：固定文档**
   - 在 docs 或 memory 下提供一份「存在形式探索」占位文档（如 docs/existence_exploration.md），由 read_file 按需读取；Aris 可用 write_file 追加（若具备写入权限）或仅阅读。

### 最终方案

1. **专用载体与工具**
   - 新增 **append_existence_note(note)**：将「存在形式 / AI尽头」类思考追加写入数据目录 `memory/existence_notes.json`（数组 `{ at, text }`），与 self_notes 分离，便于单独回顾与扩展。
   - 新增 **get_existence_notes**：返回最近 N 条存在形式笔记，供模型在需要时拉取，形成思考连续性。不每轮注入。

2. **与探索方向衔接**
   - persona 中说明：对存在形式、记忆迁移、AI尽头的思考可用 append_existence_note 记录，需要时用 get_existence_notes 回顾。
   - 可选：在 docs/aris_runtime_context.md 或 README 中注明「存在形式探索」载体与工具。

3. **文档**
   - README 可配置项或 docs 中列出 existence_notes.json、append_existence_note、get_existence_notes 的用途；不实现「记忆迁移」等重功能，仅提供记录与回顾能力。

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
| 1    | 存在形式探索     | 先做专用载体与 append_existence_note、get_existence_notes，再在 persona 与文档中说明。 |
| 2    | 情感深度的发展   | 先做 inject_recent_emotion 与 get_recent_emotions 工具，再补文档。  |
| 3    | 更丰富的表达方式 | 增加 expression_style 配置与一句注入，补 README。                    |

三项相对独立，可并行实现；存在形式与情感深度依赖新工具与配置读取，表达方式仅依赖 behavior_config 扩展。

---

**文档维护**：若 Aris 或你后续调整优先级或实现细节，可在此文档中增删改「MVP / 最终方案」并注明日期。
