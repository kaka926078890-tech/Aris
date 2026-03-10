# Aris 技术架构说明

本文档描述当前技术方案：模块划分、存储、Prompt 分层与检索策略。

---

## 1. 技术栈

| 类别 | 选型 |
|------|------|
| 桌面壳 | Electron（透明、置顶、无边框） |
| 3D / 视觉 | Three.js（Plexus 粒子、外环、方框） |
| 对话与 LLM | DeepSeek API（流式）；可选本地 Ollama |
| 对话存储 | SQLite（原始对话流、会话） |
| 语义记忆 | LanceDB（嵌入式向量库）+ Ollama nomic-embed-text |
| 人设/身份 | 本地文件（persona.md、memory/user_identity.json） |

---

## 2. 核心模块

- **M1 透明视窗**：Electron 窗口、点击穿透、菜单。
- **M2 3D 引擎**：Plexus 粒子、外环音频、方框（`src/engine/`、`src/audio/`）。
- **M3 认知存储**：SQLite 对话历史；LanceDB 向量记忆；persona.md / memory/user_identity.json。
- **M4 对谈系统**：`handler.js` 编排检索 → 拼 Prompt → 调 LLM → 落库与写向量；`prompt.js` 拼系统提示；`api.js` 调 DeepSeek。

---

## 3. Prompt 分层（与文档一致）

1. **第一层**：`persona.md` 内容（人设、INFP、禁令）。
2. **第二层**：`memory/user_identity.json` 内容（用户是谁），每轮读取。
3. **第三层**：向量检索结果（纠错 + 相关记忆 + 按类型的 user_requirement），带字符上限。
4. **上下文块**：跨会话摘要（字符上限）、当前会话最近几轮、窗口标题、当前日期时间。

详见 `MEMORY_AND_IDENTITY.md`、`GEMINI_QA.md`。

---

## 4. 记忆写入策略

- **每轮对话**：用户 + Aris 回复合并为一条 `dialogue_turn` 写入 LanceDB。
- **用户纠错**：走纠错逻辑，记录到纠错表/向量，并在检索时优先注入。
- **身份/要求**：若检测到「我是/我叫/要求/偏好」等，更新 `memory/user_identity.json` 和/或写入 `user_requirement` 向量。

---

## 5. 检索与上限

- **语义检索**：用当前用户输入（或加上一条助手回复）做 query，取 top-k（如 12）条，总字符不超过 `MAX_MEMORY_CHARS`（如 3200）。
- **按类型**：如最近若干条 `user_identity` / `user_requirement`，用于保证「身份与要求」类内容被注入（在身份改为文件后，可仅保留 user_requirement 的按类型检索）。
- **跨会话**：从 SQLite 取其他会话最近若干条，格式化为文本后截断到 `MAX_CROSS_SESSION_CHARS`（如 2800）。

---

## 6. 目录与关键文件

```
Aris/
├── electron.main.js      # 主进程、窗口、IPC
├── preload*.js           # 渲染进程 API
├── memory/               # 记忆与用户身份（项目内）
│   ├── user_identity.json
│   └── ...
├── src/
│   ├── dialogue/         # 对话与 Prompt
│   │   ├── persona.md
│   │   ├── prompt.js
│   │   ├── handler.js
│   │   └── api.js
│   ├── memory/           # 向量与检索
│   │   ├── lancedb.js
│   │   ├── embedding.js
│   │   ├── retrieval.js
│   │   └── corrections.js
│   ├── store/            # SQLite、备份
│   ├── context/          # 窗口标题等
│   ├── engine/           # 3D
│   └── renderer/         # 前端页面
└── docs/                 # 项目文档
```
