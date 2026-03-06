# 记忆与身份架构

本文档描述 Aris 的记忆分层、用户身份存储方式，以及自成长与 Token 控制策略。

---

## 1. 三层 Prompt 结构

| 层级 | 内容 | 来源 | 注入方式 |
|------|------|------|----------|
| **第一层** | Aris 人设、禁令、性格 | `persona.md` | 每轮读取文件，固定注入 |
| **第二层** | 用户身份（我是谁） | `user_identity.json` | 每轮读取文件，固定注入 |
| **第三层** | 用户要求/纠错 + 相关记忆 | LanceDB | 语义检索 + 按类型检索，带字符上限注入 |

当前会话最近几轮、跨会话摘要、窗口标题、当前时间等作为「上下文块」一并注入，均有长度上限。

---

## 2. 用户身份：文件存储

- **路径**：`src/dialogue/user_identity.json`（或由配置指定）。
- **格式**：JSON，例如 `{ "name": "xxx", "notes": "用户曾说的身份相关描述" }`。
- **更新时机**：对话中检测到「我叫/我是/你可以叫我」等表述时，解析并更新该文件；也可在设置/记忆管理里手动编辑。
- **优点**：稳定、可版本管理、易导入导出，且每轮都能完整注入，不依赖检索是否命中。

---

## 3. 纠错与偏好：向量库

- **类型**：`user_requirement`、`correction`、`dialogue_turn` 等。
- **写入**：用户纠错时写入纠错表/向量；对话轮次按「用户+助手」成对写入一条 `dialogue_turn`；若检测到「要求/偏好」类表述，额外写一条 `user_requirement`。
- **注入**：检索时按语义 + 按类型（如最近 N 条 user_requirement）取回，合并后截断到 **MAX_MEMORY_CHARS**、**MAX_CROSS_SESSION_CHARS** 等上限后再拼进 Prompt。

---

## 4. 自成长与 Token 控制

- **自成长**：数据持续写入（文件追加/覆盖、向量库新增），模型「更懂用户」、更懂自己。
- **Token 不爆炸**：  
  - 存储可以无限增长；  
  - **注入**始终有上限：身份文件通常很小；检索结果条数 + 总字符数双限；跨会话摘要也设字符上限。  
- 因此：成长体现在「数据越来越多」，而「每轮送入 LLM 的上下文」始终有封顶，不会随使用时间线性膨胀。

---

## 5. 相关文件与常量

- **人设**：`src/dialogue/persona.md`
- **用户身份**：`src/dialogue/user_identity.json`
- **Prompt 模板**：`src/dialogue/prompt.js`（`buildSystemPrompt`）
- **检索与上限**：`src/dialogue/handler.js`（`MAX_MEMORY_CHARS`、`MAX_CROSS_SESSION_CHARS`，以及 `getRecentByTypes` 条数）
