# Aris v2

v2 为完整架构重构版本，与现网（项目根 `src/`）完全隔离。

- **后端**：`packages/server` + `packages/store`，不引用现有 `src/`。
- **前端**：`apps/renderer`，React + Tailwind + lucide-react，明亮风格。
- **数据**：使用 v2 独立数据目录（Electron userData/aris-v2 或 `v2/data`），与现有 Aris 数据分离。
- **记录**：身份、要求、纠错、情感、表达欲望仅由 LLM 通过工具写入，禁止代码内解析自动写入。

## 配置

- **用户可见配置**：打开应用后进入侧栏 **设置** 页，可查看**当前数据目录**及在此保存的所有配置（对话 API、网络访问等）。配置保存在数据目录下的 `config.json`，无需编辑 .env 或环境变量。
- **开发/本地**：可复制 `.env.example` 为 `.env`，配置 `DEEPSEEK_API_KEY`、`OLLAMA_HOST` 等；若未设置，应用会使用设置页保存的 `config.json`（与打包版一致）。
- **打包分发**：无需 .env。安装后打开应用，在 **设置** 页填写 DeepSeek API Key、API 地址、网络访问开关等，点击「保存全部配置」即可；下次对话立即生效。
- **Ollama**：对话不依赖 Ollama；仅需「语义记忆/向量检索」时可选安装 [Ollama](https://ollama.com) 并执行 `ollama pull nomic-embed-text`，设置页有说明。

### 可配置项一览（memory 与 JSON）

以下文件位于 v2 数据目录下的 `memory/` 中（路径可由 `packages/config/memory_files.json` 中的文件名覆盖）。新增配置时请同步更新本表与对应文档。

| 文件 / 配置 | 说明 | 主要字段 / 格式 |
|-------------|------|------------------|
| **quiet_phrases.json** | 用户说哪些话时进入「安静」模式（不主动回复） | `quiet_phrases`: 字符串数组，如 `["歇会","安静待会","别说话"]`。命中则进入低功耗，未命中且非空消息可视为恢复对话。 |
| **retrieval_config.json** | 记忆检索与小结行为 | `enable_association_inject`、`max_association_lines`、`source_types`、`requirement_id_max`；`enable_summary`、`summary_rounds_interval`（2～50）；**分层记忆**：`filter_experience_by_association`（boolean）：search_memories 是否只返回与当前身份/要求相关经历；`max_experience_results`（number）：该模式下最多返回条数（1～20）。缺省由代码默认或首次写入。 |
| **session_summaries.json** | 各会话最新小结（自动生成，一般无需手改） | 按 session 存 `content`、`updated_at`、`round_index`。 |
| **network_config.json** | 网络访问工具（fetch_url）开关与安全策略 | `enable_web_fetch`、`allowed_hosts`、`blocked_hosts`、`timeout_ms`、`max_calls_per_minute`、`max_length`、`reject_unauthorized`（HTTPS 证书校验，false 可解决「unable to get local issuer certificate」）。详见 [网络工具配置](docs/network_tool_config.md)。 |
| **memory_files.json** | 各 memory 文件名映射 | 如 `identity`、`requirements`、`quiet_phrases`、`retrieval_config`、`session_summaries`、`network_config` 等，值为实际文件名（如 `identity.json`）。 |

**数据目录根下**（与 `memory/` 平级）：

| 文件 / 配置 | 说明 | 主要字段 / 格式 |
|-------------|------|------------------|
| **important_documents.json** | 重要文档提醒：仅对用户确需「定期查看」的文档配置；本 session 首条用户消息时若某文档超过间隔未查看则注入至多 1 句提醒。模型通过 read_file 读取到配置中的文档时会更新「最后查看时间」。若某文档为用户「按需查看、平时不用看」则不要加入或设 `check_interval_hours: 0`。 | `important_documents`: 数组，每项 `path`（相对路径，如 `docs/aris_ideas.md`）、`name`、`check_interval_hours`（0=不提醒）、`reminder_text`。缺省由代码首次使用时写入。 |

**时间线**：所有记忆/状态类写入会同时追加到 `data/timeline.json`，用于按时刻回溯或审计；详见 [记忆连贯性](docs/memory_coherence.md)。当前产品内暂无时间线展示页，数据可供排查或后续「修改历史」等能力使用。

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

## 运行

```bash
cd v2
npm install   # 根目录安装即可，postinstall 会自动在 apps/renderer 安装前端依赖
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

## 文档

- [架构](docs/architecture.md)
- [提示词策略（方案 A）](docs/prompt_strategy.md)
- [Store 层](docs/store.md)
- [向量设计](docs/vector_design.md)
- [记忆连贯性（关联/小结/分层/时间线）](docs/memory_coherence.md)
- [工具](docs/tools.md)
- [网络访问工具配置（fetch_url）](docs/network_tool_config.md)
- [分阶段执行清单](docs/todo.md)
