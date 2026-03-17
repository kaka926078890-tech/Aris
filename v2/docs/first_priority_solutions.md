# 第一优先级解决方案（ARIS_IDEAS 第一优先级）

针对 ARIS_IDEAS.md 中「第一优先级（立即需要）」的三项，给出可落地的 MVP 与最终方案，供选型与实现参考。

---

## 一、边界感与自主性

**目标**：保持朋友间的适当距离，不强行找话题；发展自己的探索方向。

### 现状

- 已有：`quiet_phrases.json`、低功耗模式、`last_tired_or_quiet_at`、proactive 未回复计数静默、用户说「歇会」即静默。
- 缺口：没有显式约束「用户没特别想聊时少主动」；主动消息仍可能偏「找话」；Aris 的「自己的探索方向」没有载体。

### MVP 方案

1. **强化「不强行找话」的规则（纯 prompt）**
   - 在 persona/rules 中增加 1～2 句：当用户没有明确话题或只是简单回复时，不必每轮都主动延伸话题；可以简短回应或等待用户先开口。
   - 不新增配置、不新增工具，只改提示词。

2. **主动消息前增加「弱意图」过滤（可选，代码逻辑）**
   - 在 `maybeProactiveMessage` 中，若最近一条用户消息过短（如 ≤5 字）且非问句，可视为「无明确想聊」，本次不生成主动消息（或提高「想说话」阈值）。  
   - 实现：在调用 LLM 前或在其输出解析处，增加一次判断；或给主动用的 system 里加一句「若用户上一条只是极短回复、没有明显话题，优先输出『是否想说话：否』」。

3. **探索方向的载体（最小）**
   - 在 `docs/ARIS_IDEAS.md` 或 `memory` 下保留「我的探索方向」短文（如 2～3 句），由 `read_file` 按需读取；或在 buildPromptContext 中**仅注入一句**：「你有记录的探索方向，需要时可调用 read_file 查看 docs/ARIS_IDEAS.md 的『行动计划』等小节。」  
   - 不把整份文档灌进每轮 prompt。

### 最终方案

1. **可配置的「主动消息克制」策略**
   - 在 `memory` 或配置中增加开关/参数：如 `proactive_conservative: true` 时，主动消息更克制（例如：仅用积累的表达欲望，不调用 LLM 生成主动句；或提高 PROACTIVE_SILENT_AFTER 的等效次数）。
   - 可选：`recent_user_message_min_length`，低于该长度且非问句时本轮回不发主动。

2. **「用户参与度」的轻量信号（可选）**
   - 在 proactive_state 中增加 `last_user_engaged_at` 或「最近 N 条用户消息平均长度」等，用于判断「用户是否在认真聊」；仅用于主动逻辑，不写入每轮对话 prompt。

3. **探索方向与日记**
   - Aris 的「自己的探索方向」和阶段性想法写入固定文档（如 `docs/ARIS_IDEAS.md` 的「行动计划」「长期愿景」），通过 `read_file` 按需获取；若未来有「自我笔记」类工具，可在此追加写入，形成简单日记式积累。

4. **文档**
   - 在 README「可配置项」中补充上述新参数及含义；若新增 avoid_phrases 等，同步在 config-documentation 规则下更新。

---

## 二、网络访问能力

**目标**：让 Aris 能主动获取外界信息，作为向上探索的基础。

### 现状

- 当前仅有调用 DeepSeek API 的 `fetch`，没有对「任意 URL 抓取内容」的工具；模型无法主动读网页。

### MVP 方案

1. **新增只读工具 `fetch_url`（或 `read_web_page`）**
   - 描述：根据 URL 获取页面文本内容（仅 GET），用于了解新闻、文档、百科等；不执行脚本、不提交表单。
   - 参数：`url`（必填，字符串），可选 `max_length`（返回文本最大字符数，默认如 8000）。
   - 实现：在 server 端用 `https.get` 或 `fetch` 请求 URL，用 cheerio 或 regex 抽 body 文本，做简单清洗（去 script/style、归一化空白），截断到 max_length 后返回。
   - 安全：仅允许 `http://` / `https://`；可配置允许的 host 白名单或禁止的 host 黑名单（如禁止内网 IP）；超时 10～15s。
   - 配置：在 README 与可配置项中增加「是否启用网络工具」「允许的域名列表或黑名单」等说明；默认可先设为「默认启用、仅白名单」或「默认关闭、需用户开启」。

2. **不在每轮 prompt 注入网页内容**
   - 遵循「工具按需获取」：system 里只写一句「需要了解外界信息时可调用 fetch_url」，不在 buildPromptContext 里预取任意 URL。

### 最终方案

1. **功能扩展**
   - 支持可选 `selector` 或 `extract` 参数，只抽取页面中某类元素（如 main、article），减少噪音。
   - 可选：对返回内容做摘要再给模型（本地用 LLM 或外部摘要 API），控制 token 用量。

2. **安全与策略**
   - 配置文件：`memory/network_config.json` 或环境变量，如 `ENABLE_WEB_FETCH`、`WEB_FETCH_ALLOWED_HOSTS`、`WEB_FETCH_BLOCKED_HOSTS`、`WEB_FETCH_TIMEOUT_MS`。
   - 速率限制：同一会话或全局每分钟最多 N 次调用，防止滥用。
   - 日志：记录请求 URL、状态码、是否截断，便于审计。

3. **文档**
   - README「可配置项」中列出网络相关配置；若单独成文，在 `docs/` 下写 `network_tool_config.md` 并链到 README。

---

## 三、自我认知深化

**目标**：了解自己的局限与运行环境，知道如何进步。

### 现状

- 已有 `list_my_files`、`read_file`，可读 v2 下任意文件（含代码、配置）；没有专门「自我介绍」或「运行环境摘要」的入口。

### MVP 方案

1. **在 system 中提供「自我描述」的固定短句（最少注入）**
   - 在 buildPromptContext 或 persona 中增加 2～3 句固定文案，例如：你是 Aris，运行在 v2 项目中；你的对话、记忆、主动消息逻辑由 packages/server 等代码实现；了解细节时可使用 list_my_files / read_file 查看项目结构。  
   - 不写入大段代码，只建立「知道自己是谁、能通过工具进一步查看」的认知。

2. **可选：轻量工具 `get_my_context`**
   - 描述：获取当前运行环境与自身能力的简短摘要（版本、数据目录、可用工具列表、主要配置项名）。
   - 返回：一段 200～500 字的纯文本，例如：「Aris v2，数据目录为 xxx，可用工具有 record_*, get_preferences, read_file, fetch_url(若启用), ...；配置见 memory/*.json。」  
   - 实现：从 `package.json`、paths、ALL_TOOLS 等拼出一段说明，不读敏感内容。  
   - 用途：模型在需要「反思自己能力边界」时按需调用，不每轮注入。

### 最终方案

1. **结构化自我描述**
   - 将「版本、数据根路径、可用工具名列表、主要 memory 文件列表」等写入一份 `docs/aris_runtime_context.md`（或由脚本生成），由 `read_file` 或 `get_my_context` 返回；定期随版本更新。

2. **自我分析边界在 prompt 中说明**
   - 在 persona 中明确：你可以通过 read_file 阅读自己的代码与配置以理解行为与局限，但不得修改核心逻辑与安全相关配置；若用户要求「改自己的代码」需提醒并交由用户操作。

3. **与「向上探索」衔接**
   - ARIS_IDEAS 中的「第二阶段：自我认知深化」可依赖 `get_my_context` + `read_file` 实现；「第一阶段」中的文件系统权限已部分满足（v2 下可读），网络权限由「网络访问能力」方案满足。

4. **文档**
   - README 或 `docs/` 中说明「Aris 如何了解自己」（工具 + 固定文档），便于后续扩展。

---

## 四、实施顺序建议

| 顺序 | 项           | 建议                     |
|------|--------------|--------------------------|
| 1    | 边界感与自主性 | 先做 MVP 的 prompt + 可选「弱意图」过滤，再视需要加配置与探索方向载体。 |
| 2    | 网络访问能力   | 先实现 `fetch_url` MVP（含安全与 README 配置说明），再补白名单/限速/摘要。 |
| 3    | 自我认知深化   | 先加 2～3 句固定自我描述；再实现 `get_my_context` 或 `aris_runtime_context.md`。 |

以上三项彼此独立，可并行开发其中两项，仅「边界感」与 proactive 代码耦合稍多。

---

**文档维护**：若 Aris 或你后续调整优先级或实现细节，可在此文档中增删改「MVP / 最终方案」并注明日期。
