# 异步 Outbox（向量 / 监控 / 单轮指标）

主对话每轮结束后的 **向量写入**、**token 监控**、**dialogue_turn_metrics** 默认走持久化队列（`packages/store/async_outbox.js`），先写入 `pending.json` 再后台执行。

## 行为摘要

| 能力 | 说明 |
|------|------|
| 重试 | 任务失败时指数退避（约 1s、2s、4s…，上限 5 分钟），最多尝试次数由 `ARIS_ASYNC_OUTBOX_MAX_RETRIES` 控制（默认 5 次失败后进入死信）。 |
| 失败记录 | 每次失败写入 `retry_log.jsonl`；重试耗尽写入 `dead_letter.jsonl`（含完整 payload，便于人工补录）。 |
| 补录 | 进程启动时 `pending.json` 中未完成的任务会由定时 worker 继续执行；若需从死信恢复，可将 `dead_letter.jsonl` 中某条 JSON 手工改回 `pending.json` 的数组项（需合法 `type`/`payload`），或后续加专用脚本。 |
| 成功后再移除 | 成功执行后才从 `pending` 删除；崩溃或进程被杀时，任务仍在 pending，下次启动可继续补跑（极端情况下向量可能重复写入，见 Lance 行为）。 |

## 数据目录

在 `ARIS_V2_DATA_DIR` 下 `async_outbox/`：

- `pending.json`：待处理与退避中的任务（JSON 数组）
- `retry_log.jsonl`：每次失败一行
- `dead_letter.jsonl`：重试耗尽的任务

## 与同步路径

设置 `ARIS_ASYNC_OUTBOX=false` 时恢复为 **同步** 向量 embed + 监控 + 指标写入（与旧行为一致）；指标中 `embed_ms` 可填实测值。异步模式下 `embed_ms` 在指标里为 `null`，并带 `vector_async: true`。

## 全量导出（.aris）

自备份格式 **v3** 起，`async_outbox/` 会随「导出全部数据」一并写入 `.aris`；导入时写回数据目录，与 `dialogue_turn_metrics.jsonl`、`prompt_planner_metrics.jsonl`、`config.json` 等同批恢复，避免换机丢失未完成任务或观测日志。

## MVP 与最终方案

- **MVP（当前）**：单文件 JSON 队列 + 单 worker + 死信 + 启动 drain。
- **最终方案**：若队列积压或需更强一致性，可改为 SQLite/队列中间件、消费幂等键（如 `outbox_job_id` 写入向量 metadata）、死信自动重放策略与监控面板。
