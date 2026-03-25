# Aris v2

v2 为完整架构重构版本，与现网（项目根 `src/`）完全隔离。

- **后端**：`packages/server` + `packages/store`，不引用现有 `src/`。
- **前端**：`apps/renderer`，React + Tailwind + lucide-react，明亮风格。
- **数据**：使用 v2 独立数据目录（Electron userData/aris-v2 或 `v2/data`），与现有 Aris 数据分离。
- **记录**：身份、要求、纠错、情感、表达欲望仅由 LLM 通过工具写入，禁止代码内解析自动写入。
- **监控**：侧栏「监控 → Token 统计」读取 `monitor/token_usage.json`。**每条 LLM 请求一行**（非「每轮用户消息一行」）：`request_kind` 为 `prompt_planner`（编排）、`chat_with_tools`（带工具的主对话，另可有 **`tool_round`** 从 0 递增）、`chat_stream`（工具后流式总结）、`estimated_turn`（整轮无官方 `usage` 时的字符估算）。官方计费且 API 返回 Prompt 缓存拆分时另有 **`prompt_cached_tokens`**、**`prompt_uncached_tokens`**（约 `input_tokens − 命中`）、**`reasoning_tokens`**。选日期后面板会显示**当日汇总**（与当前日期、会话筛选一致）：命中/未命中合计及占输入比。

## 配置

- **用户可见配置**：打开应用后进入侧栏 **设置** 页，可查看**当前数据目录**及在此保存的所有配置（对话 API、网络访问、**显示思考过程**等）。配置保存在数据目录下的 `config.json`，无需编辑 .env 或环境变量。其中「显示思考过程」默认关闭（`SHOW_THINKING=false`），在设置中开启后对话中会展示「已思考」折叠块。另可切换链路 profile（`legacy` / `collab`，重启后生效），切换后将使用 `profiles/<profile>/` 的独立历史、向量、memory 与配置空间。
- **开发/本地**：可复制 `.env.example` 为 `.env`，配置 `DEEPSEEK_API_KEY`、`OLLAMA_HOST` 等；**调试 DeepSeek 请求体**（仅本机）：`ARIS_DEBUG_DEEPSEEK_REQUEST_BODY=true` 时在后端终端打印发往 `/v1/chat/completions` 的 JSON body（`chat`、`chatWithTools`、流式 `chatStream`；含 `messages`、`stream` 等；**`chatWithTools` 默认省略 `tools` 数组**以免刷屏，需要全文时另设 `ARIS_DEBUG_DEEPSEEK_TOOLS=true`；不含 `Authorization`）；外网偶发断连可调 `ARIS_LLM_MAX_RETRIES`（默认 5 次请求）、`ARIS_LLM_RETRY_BASE_MS`（重试间隔基数）；若出现「Planner 成功、主对话带 tools 失败」且与并发无关，可保持默认 `ARIS_LLM_HTTP_CLOSE`（为 LLM 请求加 `Connection: close`，减轻对端/代理对同一 keep-alive 连接上第二次大包 RST）；若需排查可设 `ARIS_LLM_HTTP_CLOSE=false`（见 `.env.example`）；若未设置，应用会使用设置页保存的 `config.json`（与打包版一致）。**单轮观测**（可选）：`ARIS_DIALOGUE_METRICS_LOG` 默认会写入数据目录下的 `dialogue_turn_metrics.jsonl`（含 Prompt Planner 耗时、工具轮次、文件类工具调用次数、向量 embed 耗时等）；不需要时设 `false`。**异步 Outbox**（默认开启）：`ARIS_ASYNC_OUTBOX` 为 `false` 时主对话后轮次改为**同步**向量 embed + 监控 + 指标；为 `true`（默认）时先入队 `async_outbox/pending.json`，后台执行并带重试、死信与启动补录，详见 [async_outbox.md](docs/async_outbox.md)。**QQ 官方桥接**（`npm run qq-bridge`）：`ARIS_QQ_BRIDGE_PORT`、`ARIS_QQ_BRIDGE_TOKEN`；开放平台凭证 `QQ_BOT_APP_ID`、`QQ_BOT_APP_SECRET`、`QQ_BOT_TOKEN`、`QQ_BOT_UIN`（见 `.env.example`，仅本机 `.env`），见 [qq_bot_official_integration.md](docs/qq_bot_official_integration.md)。**端云协同可选变量**：`ARIS_AGENT_PROFILE`（切换 legacy/collab）、`ARIS_COLLAB_SCORE_THRESHOLD`、`ARIS_COLLAB_POLISH_THRESHOLD`、`ARIS_COLLAB_MAX_ITERATIONS`、`ARIS_LOCAL_LLM_ENABLED`、`ARIS_LOCAL_LLM_BASE_URL`、`ARIS_LOCAL_LLM_MODEL`、`ARIS_LOCAL_LLM_TIMEOUT_MS`、`ARIS_LOCAL_LLM_LOG`（默认开启：终端打印本地 Ollama 请求/响应摘要；设为 `false` 关闭）。**其它可选环境变量**：`ARIS_CHAT_TEMPERATURE`（主对话默认采样温度，默认约 0.62）、`ARIS_MAX_TOOL_ROUNDS`（单条用户消息内工具循环最大轮数，默认 25）、`ARIS_FILE_TOOL_MAX_PER_USER_TURN`（单条用户消息内文件类工具调用次数上限，默认 1000，硬顶 100000）、`ARIS_READ_FILE_MAX_CHARS`（`read_file` 单次返回截断字符数，默认约 200 万，硬顶 2000 万；仍建议控制体积以免撑爆上下文）、`ARIS_RECORD_ASYNC`（`emotion` / `expression_desire` / `self_note` 是否异步写入，默认异步；设 `false` 则同步落盘）。详见 `.env.example`。
- **无 Electron、仅用浏览器**：在 `v2` 目录配置好 `.env`（至少 `DEEPSEEK_API_KEY`，建议 `ARIS_V2_DATA_DIR`），执行 `npm run web-chat`，浏览器打开 `http://127.0.0.1:8780`（端口见 `ARIS_WEB_CHAT_PORT`）。**页面与 Electron 使用同一份** `apps/renderer/index.html`（侧栏对话/历史/向量/用户与 Aris/记忆/监控/提示词预览/设置等），由 `aris-web-bridge.js` 将 `window.aris` 转到同源 `POST /api/dialogue/send`（NDJSON 流式）与 `POST /api/rpc`。**换机/备份**：在 **设置** 页可 **导入/导出 `.aris`**（与桌面版「文件 → 导入/导出全部数据」同格式）；HTTP 亦可直接调用 `GET /api/backup/export`、`POST /api/backup/import`（请求体为备份 JSON 原文，需与对话 API 相同的 Bearer）。若导入返回 `not_found`，多半是 **web-chat 进程仍是旧代码**：在运行 `npm run web-chat` 的终端 **Ctrl+C 停止后重新执行** 即可。可选 `ARIS_WEB_CHAT_TOKEN`：设置后请在浏览器控制台执行 `localStorage.setItem('aris_web_chat_bearer','你的token')` 再刷新。详见 `apps/web-chat/server.js`、`webApiHandlers.js`。
- **打包分发**：无需 .env。安装后打开应用，在 **设置** 页填写 DeepSeek API Key、API 地址、网络访问开关等，点击「保存全部配置」即可；下次对话立即生效。
- **Ollama**：对话不依赖 Ollama；仅需「语义记忆/向量检索」时可选安装 [Ollama](https://ollama.com) 并执行 `ollama pull nomic-embed-text`，设置页有说明。
- **Electron 二进制（开发安装）**：`v2/package.json` 顶层 `config.electron_mirror`、`config.electron_custom_dir` 供 `@electron/get` 在 `npm install` 时拉取 Electron（默认 npmmirror）。也可在终端设置环境变量 `ELECTRON_MIRROR`、`ELECTRON_CUSTOM_DIR` 覆盖；若安装不完整见下方「Electron failed to install」常见问题。

### 可配置项一览（memory 与 JSON）

以下文件位于 v2 数据目录下的 `memory/` 中（路径可由 `packages/config/memory_files.json` 中的文件名覆盖）。新增配置时请同步更新本表与对应文档。

| 文件 / 配置 | 说明 | 主要字段 / 格式 |
|-------------|------|------------------|
| **quiet_phrases.json** | 用户说哪些话时进入「安静」模式（不主动回复） | `quiet_phrases`: 字符串数组，如 `["歇会","安静待会","别说话"]`。命中则进入低功耗，未命中且非空消息可视为恢复对话。 |
| **retrieval_config.json** | 记忆检索与小结行为 | `enable_association_inject`、`max_association_lines`、`source_types`、`requirement_id_max`；`enable_summary`、`summary_rounds_interval`（2～50）；**分层记忆**：`filter_experience_by_association`（boolean）：search_memories 是否只返回与当前身份/要求相关经历；`max_experience_results`（number）：该模式下最多返回条数（1～20）。缺省由代码默认或首次写入。 |
| **session_summaries.json** | 各会话最新小结（自动生成，一般无需手改） | 按 session 存 `content`、`updated_at`、`round_index`。 |
| **network_config.json** | 网络访问工具（fetch_url）开关与安全策略 | `enable_web_fetch`、`enable_web_fetch_js`（为 true 时允许 use_js 用 Puppeteer 抓取 JS 渲染页）、`allowed_hosts`、`blocked_hosts`、`timeout_ms`、`max_calls_per_minute`、`max_length`、`reject_unauthorized`。 |
| **proactive_config.json** | 主动消息克制策略 | `proactive_conservative`（true 时仅用积累的表达欲望，不调用 LLM 生成主动句）、`recent_user_message_min_length`（最近一条用户消息低于该字数且非问句时本轮回不发主动，0 表示不限制）。缺省由代码首次使用时写入。 |
| **behavior_config.json** | 自我分析/修改边界、情境、情感 | `self_analysis_boundary`、`context_aware_tone`：同上。`inject_recent_emotion`（boolean，默认 true）：为 true 时注入最近一条情感记录一句，便于情感连续性。**Prompt Planner**：默认**关闭**；`prompt_planner_enabled: true` 时主对话前多一轮编排 LLM；未启用时使用全文用户约束与全部场景规则（LEGACY）。`prompt_planner_log_metrics`（boolean）：为 true 时在数据目录追加 `prompt_planner_metrics.jsonl`。编排侧仅见**末尾短对话节选**；主对话含滑动历史，见 [prompt_packaging.md](docs/prompt_packaging.md)。 |
| **constraints_brief.json** | 用户要求/纠错/喜好的「二次摘要」，专供主对话常驻注入 | 纠错/要求/喜好合并后会 **debounce 异步** 重建；**若磁盘上尚无有效摘要**（无文件、三块皆空等）而**已有约束长文**，则在每次组装对话上下文（`buildContextDTO`）时 **await 立即重建一版**（LLM 或截断回退），无需手点。文件名可由 `memory_files.json` 的 `constraints_brief` 覆盖。 |
| **avoid_phrases.json** | 禁止用语列表（人工维护） | 格式 `{ "avoid_phrases": ["为您服务","有什么可以帮您"] }` 或直接数组。每轮在 system 中单独注入【禁止用语】块（与摘要/全文约束配合）。 |
| **conversation_rules.md** | 情境与语气、检索与 record 等规则（可选） | 纯文本。若存在则替换代码中的**基础**默认规则；可选含 `## 场景特定规则` 与 `[SCENE:CODE_OPERATION]` 等标记覆盖查代码/记忆路径/重启说明，详见 [prompt_packaging.md](docs/prompt_packaging.md)。 |
| **self_notes.json** | 自我反思笔记（record type:self_note 写入） | 数组，每项 `{ at, text }`。仅 Aris 可见，供后续会话参考。 |
| **user_profile_summary.md** | 用户画像/主题线轻量摘要（可选） | 纯文本：常聊主题、近期偏好与情绪归纳。可手动维护或由脚本生成；模型通过 get_user_profile_summary 按需获取。 |
| **aris_ideas.md** | 各实例独立的 memory 文档（不随代码提交） | 纯文本 Markdown。存于实例 memory 目录（路径可通过 get_my_context 查看）；write_file/read_file 的 relative_path 以 `memory/` 开头的均指向该目录（如 `memory/aris_ideas.md`），与代码库隔离。 |
| **memory_files.json** | 各 memory 文件名映射 | 如 `identity`、`requirements`、`constraints_brief`、`quiet_phrases`、`retrieval_config`、`session_summaries`、`network_config`、`proactive_config`、`behavior_config`、`avoid_phrases`、`self_notes`、`aris_ideas` 等，值为实际文件名（如 `identity.json`、`constraints_brief.json`）。 |
| **async_outbox/** | 主对话后轮次异步队列（非 memory） | `pending.json`、`retry_log.jsonl`、`dead_letter.jsonl`；环境变量见 [async_outbox.md](docs/async_outbox.md)。 |

**向量记忆检索（环境变量，不写进 memory JSON）**：默认启用 **向量 ANN + MiniSearch 全文混合** → **候选池内余弦重排** → 时间衰减（依赖本机 Ollama embedding）。`ARIS_MEMORY_HYBRID=false` 时回退为纯向量 + 时间衰减。可调混合/重排候选条数与权重，见 **`v2/.env.example`**（`ARIS_HYBRID_*`、`ARIS_RERANK_*`）。

**时间线**：所有记忆/状态类写入会同时追加到 `data/timeline.json`，用于按时刻回溯或审计。当前产品内暂无时间线展示页，数据可供排查或后续「修改历史」等能力使用。

**静默/低功耗**：存在。触发方式两种：（1）用户发送安静词（如「歇会」「安静待会」，见 quiet_phrases.json）→ 立即进入低功耗，不再主动发话；（2）用户长时间不回复 → 主动消息逻辑多次触发仍无用户消息时（约 3 次，即最多约 2 条主动消息后）自动进入低功耗，不再主动发话。**恢复对话**：用户**在进入静默之后**发送新消息且非安静词时退出低功耗（由 handler 处理）；定时器检查时仅当「最近一条用户消息的时间晚于进入静默时间」才视为恢复，避免把静默前的旧消息误判为恢复。

### 数据目录与 memory 文件在哪里（想改数据时怎么找）

这些 JSON 都是**真实存在磁盘上的文件**，不是看不见的缓存；只是数据目录和项目源码目录是分开的。

- **数据目录**（所有 memory 文件都在其下的 `memory/` 里）：
  - **用 Electron 跑**（`npm start` 或安装包）：在系统「应用数据」里，例如  
    - macOS：`~/Library/Application Support/<应用名>/aris-v2/`  
    - Windows：`%APPDATA%\<应用名>\aris-v2\`  
    其中的 `memory/` 里就是 `identity.json`、`quiet_phrases.json`、`retrieval_config.json` 等，用任意文本编辑器打开即可修改。
  - **想直接在项目里看到并修改**：在启动前设置环境变量，把数据目录指到项目内：  
    `ARIS_V2_DATA_DIR=v2/data`（或在 Windows 下 `set ARIS_V2_DATA_DIR=v2\data`）。  
    这样数据会落在 **`v2/data/memory/`**，在资源管理器/ Finder 里打开该文件夹即可编辑上述 JSON 文件。
- 未设置 `ARIS_V2_DATA_DIR` 且未在 Electron 环境时，默认也会使用 **`v2/data`**，即 `v2/data/memory/` 下就是这些文件。

### 之前没用 ARIS_V2_DATA_DIR 时，旧数据在哪？怎么还原？

改环境变量后，应用会从 `v2/data` 读数据，**旧数据不会被删**，还在 Electron 的应用数据目录里：

- **macOS**：`~/Library/Application Support/aris-v2/aris-v2/`（或若以 `Electron` 开发运行则为 `~/Library/Application Support/Electron/aris-v2/`）
- **Windows**：`%APPDATA%\aris-v2\aris-v2\`（或 `%APPDATA%\Electron\aris-v2\`）

**还原步骤**：把上述目录里的内容（整份拷贝即可，包含 `memory/`、`aris.db`、`lancedb/` 等）复制到 **`v2/data/`**，覆盖或合并进现有文件。之后用当前环境变量启动，就会用 `v2/data` 里的数据。

### 导出/导入全部数据（换机或备份）

菜单 **文件 → 导出全部数据** 会生成一个 `.aris` 单文件（备份格式版本 **v3**），包含当前 Aris 的全部数据，便于换机或备份。导出内容包括：

- **对话**：SQLite 数据库（`aris.db`）
- **向量记忆**：LanceDB 中的全部记忆条
- **用户与状态**：身份、状态、主动消息状态、要求、情感、纠错、表达欲望
- **监控**：token 使用、文件修改记录
- **数据目录根文件**（v3）：`dialogue_turn_metrics.jsonl`、`prompt_planner_metrics.jsonl`、数据目录下的 `config.json`（与设置页保存的配置一致，便于换机后无需重填）
- **异步队列**（v3）：`async_outbox/` 下全部文件（pending、重试日志、死信等），避免未消费任务丢失
- **配置与 memory**：timeline、associations、quiet_phrases、retrieval_config、session_summaries、preferences、network_config、proactive_config、behavior_config、avoid_phrases、constraints_brief、exploration_notes、action_cache、work_state、self_notes、user_profile_summary.md、aris_ideas.md、`memory/conversation_rules.md`（若存在）

**换机步骤**：在旧电脑上使用「导出全部数据」保存为 `.aris` 文件（如 U 盘或网盘），在新电脑上安装并打开 Aris v2，使用 **文件 → 导入全部数据** 选择该 `.aris` 文件即可一键恢复。新电脑上若使用 `ARIS_V2_DATA_DIR`，请先设好数据目录再导入。

## 运行

```bash
cd v2
npm install   # 在 v2 目录执行；postinstall 会在 apps/renderer 安装前端依赖；Puppeteer 默认不在安装阶段下载浏览器（避免网络/镜像导致失败），运行 fetch_url（use_js）时用本机 Chrome，见下方常见问题与 `.env.example`
# 可选：复制 .env 配置 DEEPSEEK_API_KEY 等；也可启动后在应用内「设置」页配置
cp .env.example .env
npm start
```

## 打包

```bash
cd v2
npm install
npm run build       # 按当前平台打包（Mac / Windows / Linux）
# 或指定平台
npm run build:mac   # 产出 dmg、zip（macOS）
npm run build:win   # 产出 nsis 安装包、portable（Windows）
npm run build:linux # 产出 AppImage（Linux）
```

产出目录：`v2/dist/`。

### 常见问题

- **`npm start` 报错：`'electron' 不是内部或外部命令`**
  - **原因**：当前环境还没有在 `v2` 目录安装依赖（尤其是 `electron`），或安装过程未完成。
  - **解决方式**：
    - 确认在 `v2` 目录执行过一次完整的依赖安装：
      ```bash
      cd v2
      npm install
      ```
    - 安装完成后重新执行：
      ```bash
      npm start
      ```

- **`npm start` 报错：`Electron failed to install correctly, please delete node_modules/electron...`**
  - **原因**：`electron` 的 postinstall 未成功下载/解压平台二进制（`node_modules/electron` 里缺少 `path.txt` 与 `dist/`），常见于网络中断、杀毒占用文件或安装过程被强行打断。
  - **解决方式**：
    1. **关掉**正在运行的 Aris / Electron、以及可能锁定 `node_modules` 的终端或 IDE 预览（必要时退出编辑器后再操作）。
    2. 在 `v2` 目录删除损坏目录后重装：
       ```bash
       cd v2
       rm -rf node_modules/electron
       npm install
       ```
       Windows 若提示占用，可在资源管理器结束相关进程后，用资源管理器删除 `v2\node_modules\electron`，再执行 `npm install`。
    3. 仓库已在 `v2/package.json` 的 **`config.electron_mirror` / `config.electron_custom_dir`** 中配置国内镜像（npmmirror），安装脚本会通过 `npm_package_config_*` 拉取二进制；若你处在特殊网络，可在当前终端临时设置后再装：`ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/`（与 `config` 中一致即可）。
  - **仍报 `EBUSY` / 无法重命名 `electron` 文件夹**：先结束所有 `Electron`/`Aris` 进程与杀毒对该项目文件夹的实时扫描，或删除整个 `v2/node_modules` 后重新 `npm install`。

- **`npm install` 在 `puppeteer` 步骤失败（Chrome / chrome-headless-shell 下载、ZIP 损坏等）**
  - **原因**：安装脚本需从外网拉取浏览器二进制，网络或镜像不稳定时易失败。
  - **默认策略**：`v2/package.json` 中已配置 `puppeteer.skipDownload`，安装阶段跳过下载；使用 **本机已安装的 Google Chrome** 作为无头浏览器。
  - **若无 Chrome**：安装 Chrome，或设置 `PUPPETEER_BROWSER_CHANNEL=msedge`（本机 Edge），或在 `.env` 中设置 `PUPPETEER_EXECUTABLE_PATH` 指向浏览器可执行文件（示例见 `.env.example`）。
  - **若需安装阶段内置浏览器**：从 `package.json` 移除 `"puppeteer".skipDownload` 后重跑 `npm install`，并保证能稳定访问官方下载源或正确配置镜像。

- **Electron 里界面像旧的（例如监控 Token 表缺少「请求 / 缓存命中」列）**
  - **原因**：若本机曾执行过 `apps/renderer` 下的 `vite build`，会生成 `apps/renderer/dist/index.html`；此前主进程**总是优先加载 dist**，与当前仓库里正在维护的 `apps/renderer/index.html` 脱节。
  - **现状**：主进程已改为比较 **源码与 dist 的修改时间**，**较新的一侧**会被加载；或删除过时的 `apps/renderer/dist` 后重启 `npm start`。浏览器 `npm run web` 始终读源码 `index.html`，一般无此问题。

### Aris 如何了解自己

Aris 可通过 **get_my_context** 工具获取当前运行环境与能力边界的简短摘要（版本、数据目录、可用工具列表、主要 memory 文件）；通过 **read_file** 阅读项目内代码与配置以理解行为与局限（不得修改核心逻辑与安全相关配置）；在仓库内可按关键词用 **search_repo_text** 定位文件路径（优先本机 `rg`）。**read_file** 在文件未改且存在 action_cache 时可能直接返回缓存摘要（工具结果中带 `from_cache: true`）；需要全文时在工具参数中传 **`force_full: true`** 从磁盘读取。

## 文档

- [后续演进方向（备忘）](docs/future_evolution_directions.md)
- [QQ 机器人（官方合规）与 Aris 对接备忘](docs/qq_bot_official_integration.md)
- [提示词分层与 Prompt Planner](docs/prompt_packaging.md)
- [分阶段执行清单](docs/todo.md)
- [第二优先级解决方案（ARIS_IDEAS）](docs/second_priority_solutions.md)
- [第三优先级解决方案（ARIS_IDEAS 长期愿景）](docs/third_priority_solutions.md)
- [记录机制改进方案（中长期未实装）](docs/record_mechanism_improvement.md)
- [管理页与内容维护（未实装）](docs/ui_management.md)
