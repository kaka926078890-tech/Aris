# 微信对接 Aris 解决方案

| 项目     | 说明 |
|----------|------|
| 文档类型 | 技术解决方案 |
| 目标     | 在微信上直接与 Aris 对话，复用现有对话与记忆能力 |
| 最后更新 | 2026-03-16 |

---

## 1. 背景与目标

### 1.1 背景

- 当前 Aris v2 仅通过 Electron 桌面端与用户交互，对话入口在应用内部。
- 希望支持用户在**微信**中直接发送消息并收到 Aris 的回复，无需打开桌面应用。

### 1.2 目标

- 用户可在微信内与 Aris 进行文本对话。
- 复用现有对话逻辑、工具调用与记忆（SQLite 对话库、LanceDB 向量检索）。
- 方案分 **MVP**（快速可用）与 **最终方案**（可扩展、多用户、稳定），便于先上线再演进。

---

## 2. 现状分析

| 维度       | 现状 |
|------------|------|
| 对话入口   | `handleUserMessage(userContent, sendChunk, sendAgentActions, signal)`，位于 `v2/packages/server/dialogue/handler.js`，通过 Electron IPC `dialogue:send` 由前端触发。 |
| 对外接口   | 无 HTTP/Web API，微信服务器无法直接调用。 |
| 会话与存储 | 使用 `store.conversations`（SQLite）与 `store.vector`（LanceDB），按 sessionId 组织；当前由 Electron 端维护当前 session。 |
| 回复形式   | 支持流式（sendChunk）与一次性返回 `content`；微信侧通常只需最终完整文本。 |

**结论**：需要为 Aris 增加「可被外部调用的文本对话接口」，并由「微信桥」将微信消息转发至该接口、将回复发回微信。

---

## 3. 方案概述

整体分为两层：

1. **Aris 侧**：提供 **HTTP Chat API**（文本入 → 调用 `handleUserMessage` → 文本出）。
2. **微信侧**：通过**微信桥**接收用户消息、请求 Aris API、将回复返回/推送给用户。

微信桥可选：**微信公众号**、**企业微信**、**Wechaty（个人微信协议）** 等，见下文。

---

## 4. MVP 方案

### 4.1 思路

- 在 v2 内增加**最小 HTTP 服务**，仅暴露一个「文本入、文本出」接口。
- 由微信桥将微信消息 POST 到该接口，并把返回的 `reply` 发回微信。
- 会话：MVP 可单 session 或按微信 userId 简单映射到一个 sessionId。

### 4.2 Aris 侧改造

| 项     | 说明 |
|--------|------|
| 实现位置 | Electron 主进程内启动 HTTP 服务，或单独 Node 进程（与主进程共享 store/config）。 |
| 接口     | `POST /wechat/message` 或 `POST /chat`。 |
| 请求体   | `{ "userId": "wechat_openid_or_any_id", "text": "用户消息" }`。 |
| 响应     | `{ "reply": "Aris 回复文本" }` 或 `{ "error": "错误信息" }`。 |
| 核心逻辑 | 根据 `userId` 确定 sessionId（MVP：userId 直接作 sessionId 或固定单 session）；调用现有 `handleUserMessage(text, noop, noop, null)`，取返回的 `content` 作为 `reply`。 |
| 依赖     | 沿用现有 store、config、handler，无需改对话与工具逻辑。 |

若 `conversations` 当前仅支持“当前 session”，MVP 可先固定一个 session，或增加「按 sessionId 切换/创建」的轻量能力（按 userId 生成 sessionId）。

### 4.3 微信桥选型

| 方式 | 说明 | 适用场景 | 注意 |
|------|------|----------|------|
| **微信公众号（订阅号/服务号）** | 在公众平台配置服务器 URL；用户发消息时微信 POST 到该 URL，可回复 XML 或调客服接口。 | 正式、多用户 | 需公网域名 + 80/443、签名校验；回复 5 秒内或走客服消息异步。 |
| **企业微信** | 自建应用/机器人，回调收消息，API 发消息。 | 企业内部、多用户 | 需企业微信、公网 URL。 |
| **Wechaty（个人微信）** | 用个人微信号登录，收消息后请求 Aris API，再发回微信。 | 个人/本地验证 | 非官方协议，存在封号风险，仅建议个人/测试。 |

- **MVP 建议**：本地验证用 Wechaty + `http://localhost:端口`；正式用公众号或企业微信 + 公网 URL（或内网穿透）。

### 4.4 部署与网络

- **本机开发**：Wechaty 与 Aris 同机，桥请求 `http://127.0.0.1:端口`。
- **公众号/企业微信**：Aris HTTP 服务需可被微信服务器访问：
  - 本机 + 内网穿透（ngrok、frp 等）得到公网 URL，或
  - 将 HTTP 服务部署到具公网 IP/域名的服务器。

### 4.5 MVP 小结

- **Aris**：新增一个 HTTP 接口，逻辑仅为「userId + text → handleUserMessage → reply」。
- **微信**：任选一种桥，将消息 POST 到该接口，把 `reply` 发回用户。
- **会话**：单 session 或简单 userId → sessionId 映射，保证同一微信用户对话连续。

---

## 5. 最终方案

在 MVP 可用基础上，扩展为可扩展、多用户、生产可用的接入方式。

### 5.1 会话与多用户

- **会话映射**：持久维护「微信 userId（OpenID/UserID）→ Aris sessionId」；新用户首次发消息时创建 session，之后固定使用，保证记忆与历史连贯。
- **多端一致（可选）**：若希望 Electron 与微信共用同一套 identity/记忆，可引入账号体系：微信 userId 与 account_id 绑定，session 按 account_id 划分。

### 5.2 微信网关独立服务

- 将**微信协议处理**从 Aris 中拆出，做成**独立网关服务**：
  - 校验微信签名（GET/POST）、解析微信 XML/JSON、组装回复或调用客服消息 API。
  - 网关只做协议转换，业务请求统一转发至 **Aris HTTP Chat API**（同上 `POST /chat` 或 `/wechat/message`）。
- **收益**：Aris 只维护「文本对话 API」；后续接钉钉、Slack、Telegram 等只需新增对应网关，复用同一套 Aris 能力。

### 5.3 超时与异步回复

- 微信要求 5 秒内响应，否则可走「异步客服消息」。
- **策略**：网关在 5 秒内先返回「收到」或占位回复，同时将任务入队；Worker 调用 Aris API 得到 `reply` 后，通过**客服消息接口**下发用户。
- Aris 侧保持「同步返回 reply」；超时、重试、队列在网关层处理。

### 5.4 安全与配置

- **接口鉴权**：HTTP API 使用 API Key 或 JWT，仅网关持有，避免接口被滥调。
- **配置外置**：微信 AppID/Secret、Token、Aris API 地址等通过配置或环境变量管理，不写死在代码中。

### 5.5 最终方案小结

- **Aris**：提供标准 **HTTP Chat API**（文本入、文本出），支持按 userId/sessionId 区分会话；Electron 与网关均可调用。
- **微信网关**：独立服务，负责微信协议、签名、异步回复与重试，仅与 Aris HTTP API 通信。
- **会话与安全**：多用户 session 映射、可选账号绑定、API 鉴权与配置外置。

---

## 6. 实施建议

1. **先做 MVP**：在 v2 内实现单一 HTTP 接口 + 本机 Wechaty 或内网穿透 + 公众号/企业微信，验证端到端流程。
2. **再拆网关**：当需要多用户、异步回复或接入更多渠道时，再落地独立微信网关与 Aris 的会话映射、鉴权。
3. **接口形态**：HTTP 服务可放在 Electron 主进程（与现有 IPC 共用进程），或独立 Node 进程通过文件/共享 store 访问同一数据目录；视部署方式选择。

---

## 7. 风险与待决事项

| 项 | 说明 |
|----|------|
| **会话策略** | 微信用户与 Electron 是否共用同一套 identity/记忆，需明确账号绑定与 session 策略。 |
| **流式/长回复** | 微信端是否要做「打字机」效果（客服消息分段发送），或始终一次性发完整句。 |
| **主动消息** | 若希望 Aris 在微信端也能主动发话，需将 proactive 逻辑抽成可被 HTTP/队列触发的形式，由网关定时或事件驱动调用并走客服消息下发。 |
| **Wechaty 风险** | 个人微信协议存在封号与政策风险，仅建议个人/测试环境使用。 |

---

## 8. 相关文档

- 架构与数据流：`v2/docs/ARCHITECTURE.md`
- 方案细节与可选点：`v2/docs/wechat_integration.md`
