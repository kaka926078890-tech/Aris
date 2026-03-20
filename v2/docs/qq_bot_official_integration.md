# QQ 机器人（官方合规）与 Aris 对接备忘

走 **腾讯 QQ 机器人开放平台** 的合规路线，**不使用** OneBot / 非官方协议登录。以下为接入思路与与 Aris 的衔接点，**具体 API 以官方文档为准**（接口与场景会迭代）。

## 官方入口（请始终以线上文档为准）

- 开放平台与入驻：<https://q.qq.com/>（主体、应用创建、审核与运营规范见站内说明）
- 开发文档总览：<https://bot.q.qq.com/wiki/>（常见含 **API v2**、事件、消息、鉴权等）
- 文档站点入口亦可从 <http://bot.qq.com/> 跳转

官方通常提供 **AppID / AppSecret**，通过接口换取 **AccessToken**（有有效期），再在请求头中携带鉴权信息调用 **OpenAPI**（详见文档「接口调用与鉴权」）。

## 官方与「协议端」的本质区别

| 官方 QQ 机器人 | 非官方 OneBot 路线 |
|----------------|------------------|
| 腾讯开放平台注册机器人，使用 **官方 API** | 第三方模拟客户端 + OneBot 约定 |
| 合规、能力边界以**平台规则与文档**为准 | 需自行承担账号与合规风险 |

## 应用场景（以文档为准）

开放平台常见会区分不同场景（例如 **QQ 频道**、**QQ 群**、**消息列表单聊** 等）。**每种场景的开放范围、事件类型、消息类型可能不同**，选型前在文档与控制台中确认「你的场景是否支持、需哪些权限」。

## 方案二（本仓库已实现基座）

**桥接服务 + 按 QQ 身份使用独立 `sessionId`**，与「仅桌面单会话」区分：

1. **对话入口**：`handleUserMessage` 支持第 5 个参数 `{ sessionId }`。传入时本回合使用该会话读写 SQLite / 向量 metadata，**不**切换桌面当前会话。
2. **本机 HTTP**：`v2/apps/qq-bridge/index.js`，`npm run qq-bridge`（默认 `127.0.0.1:8765`）。`POST /chat`，Body：`{ "text": "用户原文", "sessionId": "qq:private:xxx" }`，Header：可选 `Authorization: Bearer <ARIS_QQ_BRIDGE_TOKEN>`。
3. **开放平台凭证（环境变量）**：复制 `.env.example` 中 `QQ_BOT_*` 到本机 `v2/.env`（**勿提交**）：`QQ_BOT_APP_ID`、`QQ_BOT_APP_SECRET`（秘钥）、`QQ_BOT_TOKEN`（面板上的机器人令牌）、`QQ_BOT_UIN`（机器人 QQ 号）。网关若与桥接同机，可 `require('dotenv')` 读取以换 AccessToken、调 OpenAPI。
4. **腾讯侧**：在开放平台配置 Webhook 指到你的**公网网关**，网关将官方事件转为对上述 `POST /chat` 的调用，并用官方 OpenAPI 回消息（网关需你按最新文档实现或选用云函数）。

`sessionId` 格式建议：`qq:private:<用户标识>`、`qq:group:<群标识>` 等，**仅**含字母数字与 `_:. -`，长度 ≤160（与代码校验一致）。

### 你需要提供的物料（对接前）

| 物料 | 用途 |
|------|------|
| 开放平台 **AppID / AppSecret**（或当前文档要求的凭证） | 鉴权、调 OpenAPI |
| 机器人已开通的 **场景**（频道 / 群 / 单聊等）与 **事件订阅方式** | 决定网关如何解析消息 |
| **Webhook 公网 URL** 或 **内网穿透** 调试地址 | 腾讯回调到你的网关 |
| 若需 HTTPS：**证书或托管平台** | 生产 Webhook 常要求 HTTPS |
| **测试群 / 测试号** | 联调发消息 |
| （可选）网关运行环境：云函数、Docker、自有 VPS | 部署桥接上游 |

本仓库 **不包含** 腾讯签名校验与具体 JSON 字段解析，请以 [官方文档](https://bot.q.qq.com/wiki/) 为准在网关内实现。

### 局限（多用户）

使用显式 `sessionId` 时，**低功耗 / proactive 等仍写入全局 `aris_proactive_state.json`**，多 QQ 用户同时聊天可能互相影响；若需严格隔离，需后续按会话拆分 proactive 或单独数据目录（见 [future_evolution_directions.md](future_evolution_directions.md)）。

---

## 与 Aris v2 的衔接方式（架构）

当前 Aris 桌面端通过 **Electron IPC** 调用 `handleUserMessage`（`packages/server`），**没有对外 HTTP**。要接官方 QQ，需要新增一层 **桥接服务**（可单独 Node 进程）：

```text
腾讯 QQ 开放平台（事件 / Webhook 或长连接，以文档为准）
        → 桥接服务：验签、解析、限流
        → 调用 Aris 同一套对话逻辑（同机 require `handleUserMessage` 或 HTTP 转发）
        → 通过官方 OpenAPI 发消息回 QQ
```

要点：

1. **会话隔离**：用 QQ 侧 `group_id` / `user_id` / `channel_id` 等映射到 Aris 的 **sessionId**（若需多群多人，需扩展「按 channel 切换会话」的入口，见下方「实现注意」）。
2. **工具与安全**：QQ 场景下建议限制 **读仓库、本机路径** 等工具，避免误操作；网络类工具可单独策略。
3. **流式**：QQ 侧常先发整段或分段，桥接可先把 `handleUserMessage` 的流式拼接再发。

## MVP 与最终方案

**MVP**

- 在开放平台完成 **沙箱 / 测试** 机器人与事件订阅。
- 单机部署 **桥接服务** + 固定 `ARIS_V2_DATA_DIR` 与 API Key；**单群或单用户** 验证闭环。
- 若官方使用 **Webhook**：桥接提供 HTTPS 公网地址（或内网穿透调试）。

**最终方案**

- 鉴权（Token）、限流、健康检查、日志与告警；多租户/多实例时的数据隔离策略。
- 生产环境 **HTTPS**、重试与幂等（官方消息可能重复投递）。
- 与 Aris 的衔接可演进为 **明确 HTTP 网关**（便于与 Electron 解耦、多实例）。

## 实现注意（Aris 仓库内）

- **显式 session**：若希望「每个 QQ 群 / 每个用户」独立 memory，需要对话入口支持「**在调用前切换到指定 sessionId**」或传入上下文（当前 `handleUserMessage` 多依赖 `facade.getCurrentSessionId()`，桥接层可能要小改或封装会话切换逻辑）。
- **配置**：桥接进程需能读到与桌面端一致的 **DeepSeek API** 与 `ARIS_V2_DATA_DIR`（见 `v2/.env.example`）。

---

*文档仅作方向备忘；接口路径、字段名、鉴权方式以 [QQ 机器人官方文档](https://bot.q.qq.com/wiki/) 为准。*
