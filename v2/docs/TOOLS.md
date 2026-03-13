# v2 工具列表与触发

## 记录类（仅 LLM 触发，只调 store）

| 工具名 | 参数 | 调用 store | 说明 |
|--------|------|------------|------|
| record_user_identity | name?, notes? | identity.writeIdentity | 不解析用户消息，仅工具调用时写入 |
| record_user_requirement | text | requirements.appendRequirement | 同上 |
| record_correction | previous, correction | corrections.appendCorrection | 同上 |
| record_emotion | text, intensity?, tags? | emotions.appendEmotion | 同上 |
| record_expression_desire | text, intensity? | expressionDesires.appendDesire | 同上 |

## 文件类

| 工具名 | 说明 |
|--------|------|
| list_my_files | 列出 v2 约定目录 |
| read_file | 读取相对路径文件 |
| write_file | 写入/追加 |
| delete_file | 删除文件 |

## 记忆与时间

| 工具名 | 说明 |
|--------|------|
| search_memories | query 加 search_query: 后 embed 检索 vector |
| get_corrections | corrections.getRecent |
| get_current_time | 当前日期时间 |

## 执行与塞回

- 工具执行结果作为 tool 消息追加回对话（如 `{ ok: true }`），便于模型确认。
