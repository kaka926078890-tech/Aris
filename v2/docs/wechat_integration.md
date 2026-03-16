# 微信对接 Aris 方案

目标：在微信上直接给 Aris 发消息并收到回复，复用现有对话与记忆能力。

## 现状简要

- Aris v2 对话入口在 **Electron 主进程**：`handleUserMessage(userContent, sendChunk, sendAgentActions, signal)`，通过 IPC `dialogue:send` 由前端触发。
- 无对外 HTTP 接口，微信无法直接调用。
- 微信侧需要：**能收到用户消息的端点**（公众号/企业微信回调，或 Wechaty 等）→ 把消息转给 Aris → 把 Aris 的回复发回微信。

---

## MVP 方案

**思路**：在 v2 内增加一个**最小 HTTP 服务**，对外提供「文本入、文本出」的接口；由**微信桥**（公众号/企业微信/Wechaty 等）把微信消息 POST 到该接口，并把返回的回复发回微信。

### 1. Aris 侧（v2 内）

- 在 Electron 主进程或单独 Node 进程里起一个 **HTTP 服务**（如 Express），只暴露一个接口，例如：
  - `POST /wechat/message` 或 `POST /chat`
  - 请求体：`{ "userId": "wechat_openid_or_any_id", "text": "用户发的消息" }`
  - 响应：`{ "reply": "Aris 的回复文本" }`（或 `{ "error": "..." }`）
- 接口内部：
  - 用 `userId` 映射到 Aris 的 `sessionId`（MVP 可简单用 `userId` 当 sessionId，或全用同一个固定 session）。
  - 调用现有 **`handleUserMessage(text, noop, noop, null)`**（不推流、不推 agent 动作），取返回值里的 `content` 作为 `reply`。
- 数据与 store：沿用现有 SQLite/LanceDB 与 v2 路径；若按 userId 分 session，需在 `conversations` 里支持「按 sessionId 切换/创建会话」（若当前已有 getCurrentSessionId，MVP 可先固定一个 session 或按 userId 拼一个 sessionId 再切过去）。

### 2. 微信侧（桥）

任选一种能把「微信消息 → HTTP 请求」和「HTTP 响应 → 微信回复」连起来的方式：

| 方式 | 说明 | 注意 |
|------|------|------|
| **微信公众号（订阅号/服务号）** | 在公众平台配置「服务器地址」为你的公网 URL；用户发消息时微信会 POST 到该 URL，你返回 XML 或调用客服接口回复。 | 需要公网域名 + 80/443、签名校验；回复需在 5 秒内或走客服消息异步。 |
| **企业微信** | 自建应用或机器人，通过回调接收消息，再调用发消息 API 回复。 | 需要企业微信企业号、公网可访问 URL。 |
| **Wechaty 等（个人微信协议）** | 用库登录「个人微信」账号，收到消息后请求你的 HTTP 接口，再把返回内容发回微信。 | 非官方协议，存在封号风险，仅适合个人/测试。 |

MVP 下：**公众号/企业微信**适合正式一点；**Wechaty** 适合本地快速验证（本机跑 Wechaty，请求 `http://localhost:端口/wechat/message`）。

### 3. 部署与网络

- **本机开发**：微信桥（如 Wechaty）和 Aris 都在本机；桥请求 `http://127.0.0.1:端口`。
- **公众号/企业微信**：Aris 的 HTTP 服务需能被微信服务器访问，即：
  - 本机 + 内网穿透（ngrok、frp 等）得到公网 URL，或
  - 把「HTTP 接口 + handleUserMessage」部署到一台有公网 IP/域名的服务器（同一台机器或 Aris 本机做穿透均可）。

### 4. MVP 小结

- **Aris**：新增一个 HTTP 接口，内部只做「userId + text → handleUserMessage → reply」。
- **微信**：用公众号/企业微信/Wechaty 之一做桥，把消息 POST 到该接口，把 `reply` 发回用户。
- **会话**：MVP 可单 session 或简单按 userId 映射到一个 sessionId，保证同一微信用户对话连续即可。

---

## 最终方案

在 MVP 可用的基础上，扩展为**可扩展、多用户、稳定**的微信接入：

### 1. 会话与多用户

- **会话映射**：维护 `userId（微信 OpenID/UserID）→ Aris sessionId` 的持久映射；新用户首次发消息时创建新 session，之后固定用该 session，保证记忆与历史连贯。
- **多端一致（可选）**：若希望同一用户在 Electron 端和微信端共用同一套记忆，可用「账号体系」：微信 userId 与本地 account_id 绑定，session 按 account_id 划分。

### 2. 微信网关独立服务

- 将「微信协议处理」从 Aris 中拆出，做成**独立网关服务**：
  - 校验微信签名（GET/POST）、解析微信 XML/JSON、组装回复 XML 或调用客服消息 API。
  - 网关只负责协议转换；业务请求统一转发到 **Aris 的 HTTP Chat API**（即上面的 `POST /chat` 或 `/wechat/message`）。
- 好处：Aris 只维护「文本对话 API」，后续接钉钉、Slack、Telegram 等只需再加对应网关，复用同一套 Aris 能力。

### 3. 超时与异步回复

- 微信公众平台要求 5 秒内响应，否则可走「异步客服消息」。
- 网关策略：先 5 秒内返回「收到」或空回复（或提示「正在想…」），同时把任务丢给队列；Worker 调 Aris HTTP 接口拿到 `reply` 后，再通过**客服消息接口**发到用户。
- Aris 侧接口可维持「同步返回 reply」；超时与重试在网关/队列层处理。

### 4. 安全与配置

- 接口鉴权：HTTP API 加 API Key 或 JWT，仅网关持有；防止接口被滥调。
- 配置外置：微信 AppID/Secret、Token、Aris API 地址等放在配置或环境变量，不写死在代码里。

### 5. 最终方案小结

- **Aris**：提供标准 **HTTP Chat API**（文本入、文本出），支持按 `userId`/`sessionId` 区分会话；可继续用 Electron 本地使用，同时被微信网关调用。
- **微信网关**：独立服务，处理微信协议、签名、异步回复与重试；只与 Aris HTTP API 通信。
- **会话与安全**：多用户 session 映射、可选账号绑定、API 鉴权与配置外置。

---

## 你可后续决定的事项

- **会话策略**：微信用户与 Electron 是否共用同一套 identity/记忆（要则需账号绑定与 session 策略）。
- **流式/长回复**：微信端是否要「打字机」效果（客服消息可分段发送），还是始终一次性发完整句。
- **主动消息**：若希望 Aris 在微信里也能「主动说话」，需在网关侧定时或事件驱动调 Aris（或 proactive 模块）并走客服消息下发；当前 proactive 在 Electron 内，需抽成可被 HTTP/队列触发的逻辑。

以上为方案梳理，未改你现有代码；确定采用 MVP 或最终方案中的哪一部分后，再落实现码不迟。
