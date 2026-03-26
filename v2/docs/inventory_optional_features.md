# v2 可选功能与默认关闭项（维护清单）

便于判断「是否删除整段子系统」：下列为 **默认关闭或按需开启**。

| 能力 | 默认 | 开启方式 | 说明 |
|------|------|----------|------|
| web-chat Bearer | 关 | `ARIS_WEB_CHAT_TOKEN` | 无 token 则同源开放（仅调试需注意） |
| DeepSeek 请求体调试 | 关 | `ARIS_DEBUG_DEEPSEEK_*` | 仅排查 |
| 对话指标 JSONL | 开 | `ARIS_DIALOGUE_METRICS_LOG=false` 可关 | `dialogueMetrics.js` |
| 异步 Outbox | 开 | `ARIS_ASYNC_OUTBOX=false` 可关 | 向量写入等改同步 |
| 记忆混合检索 | 开 | `ARIS_MEMORY_HYBRID=false` 纯向量 | `vector.js` |
| 记忆第二阶段 RRF | 开 | `ARIS_MEMORY_FINAL_STAGE2=false` 旧排序 | `vector.js` |

**已从代码移除**：Prompt Planner、端云协同（collab + 本地评审）、QQ 官方桥、`fetch_url` 网络工具、HTTP 记忆精排服务。
