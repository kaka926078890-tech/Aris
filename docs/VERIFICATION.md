# Aris 分步验证清单

按顺序完成并验证每一步，确保链路打通后再做下一步。

---

## 1. 视觉与窗口（仅前端）

**验证**：`npm start` 后能看到透明窗口、外环 + 方框 + Plexus 粒子，外环随测试音频有轻微波动。

**涉及**：`electron.main.js`、`src/renderer/*`、`src/engine/*`、`src/audio/waveform.js`

**若失败**：检查 Electron 是否安装成功、renderer 是否打包成功（`npm run build:renderer`）。

---

## 2. 本地存储（SQLite，主进程）

**验证**：能写入/读取对话而不报错。可在主进程临时加日志：收到 `dialogue:send` 时先只做「写入 SQLite + 读回」再返回固定文案，不调 LLM。

**涉及**：`src/store/db.js`、`src/store/conversations.js`（sql.js 需用 `initSqlJs()` 再 `new SQL.Database()`）。

**若报错 `sql.Database is not a constructor`**：说明 sql.js 未用 `initSqlJs()` 初始化，见 `db.js` 中的 `SQL = await initSqlJs()`。

---

## 3. 对话链路（主进程 → LLM → 返回）

**验证**：配置 `DEEPSEEK_API_KEY` 后，点击中心、输入文字、点发送，能收到 Aris 的回复并显示在气泡里。

**涉及**：`src/dialogue/handler.js`、`api.js`、`prompt.js`，以及 IPC `dialogue:send`、渲染层气泡与 `aris.sendMessage()`。

**若失败**：先确认 2 已通过；再查主进程日志（DeepSeek 报错、网络、API Key）。

---

## 4. 记忆与检索（LanceDB + 本地向量化）

**验证**：配置 Ollama + nomic-embed-text 后，多轮对话里能明显感到 Aris 用到了「之前说过的话」；或主进程日志里能看到检索到的记忆条。

**涉及**：`src/memory/lancedb.js`、`embedding.js`、`retrieval.js`，以及 `handler.js` 中的 retrieve → 注入 prompt。

**若失败**：确认 Ollama 已启动、embedding 接口可用；LanceDB 表是否创建、向量维度是否一致。

---

## 5. 主动发言（Aris 主动发消息）

**验证**：不操作一段时间后，偶尔能收到 Aris 主动发来的一条消息（由状态推断，非写死规则）。

**涉及**：`src/dialogue/proactive.js`、主进程定时器、IPC `aris:proactive`、渲染层 `onProactive` 与气泡展示。

---

## 6. 窗口标题（环境感知）

**验证**：对话时 Aris 的回复里能提及或呼应「你当前在用的应用/窗口」（若实现为注入窗口标题）。

**涉及**：`src/context/windowTitle.js`、主进程获取前台窗口、`handler.js` 中注入 `window_title`。

---

**说明**：本项目的「后端」逻辑（存库、记忆、调 LLM）全部在 **Electron 主进程** 中完成，没有单独的 HTTP 后端服务；渲染进程只负责 UI 和通过 IPC 调用主进程。
