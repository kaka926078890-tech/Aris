# 缓存记忆模块设计：解决「做过的事 / 处理过的内容」可被复用

用于解决：Aris 记不住之前做过的事、处理过的内容，每次都要重复读同一文件、重复执行相同理解等问题。

---

## 附录 A：当前提示词是否分层、是否适合「先理解意图再注入」

**1. 现在有分层处理吗？**  
**没有。** 当前是「单层、一次性注入」：
- `contextBuilder.buildContextDTO()` 一次性从 store 拉齐：身份、用户约束、当前会话、状态、关联、小结、情感等；
- `buildSystemPrompt(dto)` 用一条 `CONTEXT_TEMPLATE` 把上述全部拼成一段 system，没有「先注入基础层、再按需注入扩展层」的分层，也没有按「角色/任务」切换不同模板。

**2. 现在适合做「LLM 先理解用户意图，再注入合适提示词」吗？**  
**不适合，需要改流程。** 当前是「每轮固定模板 + 固定块全量注入」，没有：
- 先对用户消息做一次轻量意图识别（例如：是否在问某文件、某任务、纯闲聊、要执行操作等）；
- 再根据意图选择注入哪些块、或调用哪些工具（如先查缓存再决定是否 read_file）。  
若要支持「意图先行」，需要增加一环：在 `buildPromptContext` 之前或之中，先跑一次意图识别（规则或小模型），再根据结果决定 DTO 里填哪些块、或先查 action_cache 再组 prompt。

---

## 一、问题与目标

| 问题 | 目标 |
|------|------|
| 不记得本会话/历史会话里读过哪些文件、写过什么 | 能查「某路径最近一次读/写的内容或摘要」，避免重复 read_file |
| 不记得对某主题/某文件做过什么结论或操作 | 能查「针对某 key（如文件路径、任务 id）的最近结论/操作摘要」 |
| 跨轮、跨会话后完全遗忘 | 持久化「操作/结论」缓存，并按 key 或语义检索 |

### 举例：「再去看代码」时不用每次都从根目录读起

- **第一次**：用户说「帮我看下对话相关代码」。Aris 调 `read_file` 读了 `packages/server/dialogue/handler.js`、`prompt.js`、`contextBuilder.js` 等。每读成功一个，就**自动**写一条 action_cache：key=`file:packages/server/dialogue/handler.js`，result_summary=该文件内容摘要。
- **第二次**：用户说「再去看下代码」或「继续看 handler 那块」。Aris **先调工具** `get_read_file_cache`（可带 `path_prefix: 'packages/server'`、`limit: 20`），拿到「已读过且 mtime 仍有效」的 **path + 摘要**列表。列表里已经带**完整路径**（如 `packages/server/dialogue/handler.js`），所以 Aris **不用再从根目录 list_my_files 一步步找**——直接知道「这些 path 我读过、摘要仍有效」，要再看细节就 `read_file(该 path)`，不必先 list 再一层层点进去。

**那第一次看、或要看从没读过的文件时呢？**  
若没有任何「项目结构」提示，Aris 可能还是会 `list_my_files('')` → 再 list 子目录 → 一步步找。可补充：在 **get_my_context** 或 prompt 里给一句**极简项目结构**（如「v2 主要代码：packages/server（对话/LLM/配置）、packages/store、apps/electron、apps/renderer；对话逻辑在 packages/server/dialogue」），这样 Aris 第一次就能**直奔**相关目录（如 `list_my_files('packages/server/dialogue')` 或直接根据文档 read 常见路径），不必从根目录一层层找。

---

## 二、采用方案：持久化 + 按 key 复用（最终方案）

**思路**：持久化「操作/结论」缓存，支持按 key（如文件路径、任务 id）查询与更新，并可做简单语义检索。

1. **存储**
   - 新 store：`action_cache`（或 `cache_memory`）。每条：`{ id, key, key_type, action, args_summary, result_summary, session_id?, created_at[, file_path?, file_mtime_at_cache?] }`
   - `key`：如 `file:memory/aris_ideas.md`、`task:优化提示词`。同一 key 可只保留最近 1 条或最近 N 条（按需）。
   - **file 类**：必须带 `file_path`、`file_mtime_at_cache`（写入缓存时该文件的 mtime），用于「文件是否被修改」校验，见第三节。

2. **写入（不会记录「所有」操作，只记录约定类型）**
  - **会写入缓存的**：
    - **read_file**：写入 `file:${relative_path}` 的读取摘要 + 文件 mtime（用于判断是否仍有效）。
    - **list_my_files**：写入 `dir:${subpath}` 的目录条目列表 + 目录 mtime（用于判断目录是否仍有效）。
    - **write_file/delete_file**：用于失效相应的 `file:${...}` 条目，并失效该文件所在目录 `dir:${dirname}` 的目录缓存（避免目录列表陈旧）。
  - **目录结构**：现在会记录。也就是说，**list_my_files(subpath)** 在成功返回后会写入 action_cache，下一次同目录 list 时可直接复用缓存条目（前提目录 mtime 未变化）。
   - **暂不写入缓存的**：其他工具（如 record、get_record、search_memories、get_current_time、git_status、fetch_url 等）不自动写入 action_cache。
   - 可选：对「用户明确说记住」的结论，用 `record(type: 'action_cache', payload: { key, conclusion })` 写入。

3. **读取与使用**
   - **按 key/路径查**：通过 `get_read_file_cache` 获取「仍有效的文件摘要」（path + result_summary）。模型可先读缓存再决定是否需要 `read_file`。
   - **按会话/最近查**：通过 `get_recent_read_file_cache` 获取「当前会话内最近已读文件摘要」（同样做 mtime + 存在性校验），用于对话中继续阅读、减少重复定位。
   - **使用方式**：本设计不依赖 contextBuilder 每轮注入「已读列表」到 system（避免 prompt 变长）。而是让模型在需要时按工具返回结果来决定下一步 read_file。

4. **与现有能力的关系**
   - 与 **search_memories**（向量检索对话/经历）区分：action_cache 是「结构化操作/结论缓存」，key 明确；向量检索是语义相似。
   - 与 **self_note** 区分：self_note 是模型主动写的反思；action_cache 是工具调用结果的自动沉淀。

5. **配置**
   - 可配置：是否开启 action_cache、每条 result_summary 最大长度、每会话最多注入条数、是否持久化到磁盘（SQLite/JSON）。

---

## 三、文件是否被修改的标记 & 摘要何时仍有效

**问题**：缓存的是「某路径当时读/写的结果摘要」。若之后文件被修改，旧摘要就失效，必须能识别并避免误用。

### 3.1 如何标记「文件已被修改」

| 来源 | 做法 |
|------|------|
| **本进程写入** | 执行 `write_file(relative_path, content)` 成功时，对该路径对应的 cache key（如 `file:${relative_path}`）做**失效或更新**：删除该 key 的缓存条目，或写入新条目（action=write_file, result_summary=本次写入的摘要）。这样「被我们改过的文件」不会继续使用旧读缓存。 |
| **外部修改** | 本进程未调用 write_file、但用户或其它程序改了文件时，用**文件 mtime 校验**：缓存条目中保存 `file_mtime_at_cache`（写入缓存时用 `fs.statSync` 记下的 mtimeMs），或至少保存 `created_at`。每次**使用**该条缓存前，对磁盘上的文件再 `stat` 一次，若当前 `mtime > file_mtime_at_cache`（或当前 mtime 与存入时不一致），则视为已修改，**不使用该条缓存**（或标记失效、待下次 read_file 时刷新）。 |

实现要点：
- 写入缓存时：对 `read_file(path)` 类操作，在写入 action_cache 时一并写入 `file_path` 与 `file_mtime_at_cache`（或 mtimeMs）。
- 使用缓存时：若 key 为 `file:xxx`，先取真实路径并 `fs.statSync`（若文件不存在则缓存失效）；若存在且 mtime 大于缓存时的 mtime，则本条摘要视为失效，不注入、不返回，由调用方决定是否重新 read_file。

### 3.2 当前摘要是否还有意义

**仅当「自缓存写入以来该文件未被修改」时，摘要仍有意义。**

- 若**本进程**之后对该路径调用了 `write_file`：已在 3.1 中通过「写入时失效/更新」保证，不再使用旧摘要。
- 若**外部**修改了文件：通过 3.1 的 mtime 校验，在使用前发现已修改则不用该摘要，避免「记住了旧内容、实际已变」的错用。

因此：**每条 file 类缓存需带「文件路径 + 写入缓存时的 mtime」**；使用前做 mtime 比对，通过才认为摘要仍有效。

---

## 四、用哪种方式实现：工具 vs 流程 vs 提示词

**结论：不把已读文件列表每轮灌进 prompt（提示词已经很多，且项目读满时文件太多），改为提供「按需查询」的工具。**

| 方式 | 采用 | 说明 |
|------|------|------|
| **流程上的控制** | **要** | 在 `read_file` / `write_file` 成功返回后**自动**写 action_cache，不依赖模型多调一个记录工具。 |
| **提示词的添加** | **不** | 不再在 system 里加「【你已读过的文件】整块列表」。避免 prompt 继续变长，且项目读满时条目过多。 |
| **新工具** | **要** | 提供工具，让模型在需要时再查「我读过哪些文件 / 某 path 的摘要是否还有效」。按需查、返回条数可控（如最近 20 条、或按 path 前缀筛），不撑爆 prompt。 |

工具建议命名与参数（示例）：
- **get_read_file_cache**：  
  - `options.path_prefix`（可选）：只返回路径以此前缀开头的条目，如 `packages/server`。  
  - `options.limit`（可选，默认 20）：最多返回条数。  
  - **返回**：列表 `[{ path, result_summary, cached_at }]`。每条在返回前做**三项校验**，不通过则自动过滤、不返回该条：  
    1. **文件路径**：返回的就是已读过的 path，供你决定「哪些可复用、哪些要新读」。  
    2. **文件是否更新**：对磁盘上的文件做 mtime 比对，若自缓存后已被修改，则该条视为失效，不返回。  
    3. **文件是否存在或更换地址**：若该 path 下文件不存在（被删或已移动），stat 失败，该条视为失效，不返回。  
  - 因此工具返回的列表 =「当前仍可信任的：路径存在、内容未改的已读摘要」，可直接用于「先看摘要再决定是否 read_file」。

- **get_recent_read_file_cache**：
  - `options.path_prefix`（可选）：仅返回当前会话内、路径以此前缀开头的已读文件。
  - `options.limit`（可选，默认 20）：最多返回条数。
  - **返回**：列表 `[{ path, result_summary, cached_at }]`，并在返回前校验 mtime 与文件存在性，保证摘要仍有效。

- **get_dir_cache**：
  - `options.subpath`（可选）：要查询的目录相对子路径；空表示 v2 根目录。
  - `options.limit`（可选，默认 50）：最多返回目录条数。
  - **返回**：`{ hit: boolean, list: string[] }`，其中 `list` 来自缓存条目，并在返回前校验目录 mtime 与存在性，确保目录列表仍有效。
  

**persona/对话规则**：用原则性表述，不写死具体话术或场景。例如：  
「需要查看目录结构或读取文件内容前，可先分别调用 get_dir_cache / get_read_file_cache，复用仍有效的目录与文件摘要；若缓存未命中或已失效，再调用 list_my_files / read_file 获取最新内容。」  
不写「再看代码」「继续看某目录」等硬编码触发词。

---

## 五、实现顺序建议

1. 新增或扩展 `store/action_cache.js`：同时支持
   - **file**（read_file 摘要，含 `file_mtime_at_cache` 校验）
   - **dir**（list_my_files 返回，含目录 `mtime` 校验）
2. **流程**：在 file 工具层
   - `read_file` 成功后写入该 `file:${relative_path}` 缓存
   - `list_my_files` 成功后写入 `dir:${subpath}` 缓存
   - `write_file/delete_file` 成功后失效对应文件缓存，并失效该文件所在目录的目录缓存
3. **工具**：提供
   - `get_read_file_cache` / `get_recent_read_file_cache`
   - `get_dir_cache`
4. **提示词**：不在 system 里加整块列表；在 persona/对话规则里用原则性表述：需要读取文件或列目录前，可先用缓存工具判断是否仍有效，未命中再调用 list_my_files / read_file。

---

## 六、与提示词分层、意图先行的关系

- **当前**：无分层、无意图先行；缓存记忆可独立于两者先做。
- **若后续做「先理解意图再注入」**：意图模块可输出「用户可能在问某文件/某任务」→ 再查 action_cache 注入对应块，避免每轮全量注入大量缓存。
