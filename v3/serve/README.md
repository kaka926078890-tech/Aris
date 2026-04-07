# aris_v3_serve

一个最小后端，只做三件事：

1. 固定中文人设；
2. 调用 llm_api 对话；
3. 本地保存聊天记录和向量数据。

## 快速启动

```bash
cd v3/serve
cp .env.example .env
npm install
npm run dev
```

最少只需要配置 `DEEPSEEK_API_KEY`。

## 接口

- `GET /health`
- `POST /chat`
- `POST /chat/preview`（仅预览提示词，不落库、不调用对话模型）
- `GET /conversations`
- `GET /conversations/current`
- `PUT /conversations/current`
- `GET /conversations/:id`
- `GET /conversations/:id/messages`
- `DELETE /conversations/:id`
- `DELETE /conversations`

### post_/chat 请求体（snake_case）

```json
{
  "message": "你好",
  "conversation_id": "可选_已有会话_id",
  "model": "可选_模型名",
  "include_trace": false
}
```

### 记忆检索（最终方案）

- 每轮会对两类内容做向量化并落库：
  - 单条消息：`user` / `assistant` 各一条
  - 对话片段：`用户+回复` 组合成一条 turn 片段
- 每次对话会先做语义检索，再把召回记忆与最近轮历史一起打包进 prompt。
- 默认不检索当前会话（避免与 recent history 重复），仅从历史会话召回，并按「片段优先 + 消息补充」融合。
- 注入前会与 recent history 做归一化去重，避免重复文本二次注入。
- Prompt 注入优先级：
  1) 结构化长期记忆（身份/偏好/纠错）  
  2) 语义召回记忆（跨会话）  
  3) 最近聊天历史（较早历史自动降权为截断文本）
- 这样可在不牺牲“长期记忆能力”的前提下，降低旧闲聊对当前语境的干扰。

### 聊天工具层（对齐 v2 最小聊天能力）

`/chat` 已接入 function tools（自动工具调用，最多 3 轮）：

- `record`
  - `identity`：写用户信息（name/notes）
  - `preference`：写喜好（topic/summary/source/tags）
  - `correction`：写纠错（previous/correction）
- `get_record`
  - `identity` / `preferences` / `corrections`
- `search_memories`
  - 语义检索历史记忆（跨会话）
- `get_current_time`
  - 返回当前时间
- `web_search`
  - 查询最新公开网页信息（标题/链接/摘要）
- `web_fetch`
  - 抓取指定 URL 正文（用于核对细节）

### 历史接口补充

- `GET /conversations` 额外返回：
  - `message_count`: 会话消息数
  - `last_message_preview`: 最近一条消息预览
  - `is_current`: 是否当前会话
- `GET /conversations/:id/messages` 支持 `newest_first=true`（按最新优先返回）
- `GET /conversations/current` 返回当前会话 id（可为 null）
- `PUT /conversations/current` 请求体：

```json
{
  "conversation_id": "会话_id_或_null"
}
```

## 当前结构

```txt
src/
  index.ts
  config.ts
  logger.ts
  errors.ts
  types.ts
  app/
    promptPolicy.ts
    promptBuilder.ts
    chatService.ts
    chatTools.ts
  infra/
    database.ts
    conversationRepo.ts
    messageRepo.ts
    recordRepo.ts
    llmClient.ts
    embeddingClient.ts
    vectorStore.ts
  api/
    server.ts
    chatRoute.ts
    conversationRoute.ts
```

## 配置项

以 `.env.example` 为准，文档与实现已同步。  
重点配置：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_API_URL`
- `LLM_DEFAULT_MODEL`
- `OLLAMA_HOST`
- `ARIS_EMBED_MODEL`
- `ARIS_V2_DATA_DIR`
- `ARIS_WEB_TOOLS_ENABLED`（是否启用联网工具）
- `ARIS_WEB_SEARCH_API_URL`（搜索 API 地址）
- `ARIS_WEB_SEARCH_API_KEY`（搜索 API 密钥）
- `ARIS_WEB_SEARCH_MAX_RESULTS`
- `ARIS_WEB_FETCH_TIMEOUT_MS`
- `ARIS_WEB_FETCH_MAX_CHARS`
- `PROMPT_RECENT_TURNS`
- `PROMPT_RETRIEVAL_ENABLED`
- `PROMPT_RETRIEVAL_TOP_K_TURN`
- `PROMPT_RETRIEVAL_TOP_K_MESSAGE`
- `PROMPT_RETRIEVAL_SCORE_THRESHOLD`
- `PROMPT_RETRIEVAL_EXCLUDE_CURRENT_CONVERSATION`
