# aris_v3_架构说明

## 目标

只做最小闭环：

1. 一个人设（中文 system_prompt）；
2. 一个对话流程（输入 -> prompt -> llm -> 输出）；
3. 一个本地存储（sqlite 消息 + 向量）。

## 主流程

1. `POST /chat` 接收用户输入；
2. 保存用户消息到 sqlite；
3. 读取最近历史，组装 prompt；
4. 调用 llm_api 生成回复；
5. 保存助手消息到 sqlite；
6. 同步调用 embedding_api，把用户/助手两条消息写入向量存储。

说明：没有检索编排、没有异步队列、没有多模型路由，保持最简单可维护。

## 模块拆分

```txt
api_layer
  chatRoute.ts
  conversationRoute.ts
  server.ts

app_layer
  promptPolicy.ts
  promptBuilder.ts
  chatService.ts

infra_layer
  database.ts
  conversationRepo.ts
  messageRepo.ts
  llmClient.ts
  embeddingClient.ts
  vectorStore.ts
```

## 存储结构

- `conversations(id, title, created_at, updated_at)`
- `messages(id, conversation_id, role, content, created_at, token_count, metadata_json)`
- `embeddings(id, message_id, model, dimension, vector_json, created_at)`

## 命名约定

- 对外接口字段统一 `snake_case`：
  - `conversation_id`
  - `include_trace`
  - `created_at`
  - `token_count`

## 后续扩展（按需）

- 要检索再加检索，不提前做；
- 要异步再加队列，不提前做；
- 要多模型再加路由，不提前做。
