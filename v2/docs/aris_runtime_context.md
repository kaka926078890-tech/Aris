# Aris 运行环境与自我认知

本文档说明 Aris 如何了解自己的运行环境与能力边界。**实时摘要请调用工具 `get_my_context`**，会返回当前版本、数据目录、可用工具列表、主要 memory 文件等。

## 通过 get_my_context 获取

- 在对话中需要「反思自己能力边界」或「了解当前运行环境」时，调用 **get_my_context** 即可获得一段 200～500 字的纯文本摘要。
- 内容包含：Aris v2 版本号、数据目录路径、可用工具名列表、memory 下主要配置文件列表。
- 不包含敏感内容；细节可通过 read_file 查看本仓库下的代码与配置。

## 通过 read_file 进一步查看

- **项目结构**：`list_my_files` 可列目录，`read_file` 可读任意 v2 下文件。
- **对话与记忆逻辑**：`packages/server/dialogue/`（handler、prompt、proactive、tools）。
- **存储与状态**：`packages/store/`（identity、preferences、state、vector 等）。
- **配置与路径**：`packages/config/paths.js`、`packages/config/memory_files.json`。

## 自我分析边界（可配置）

- **默认**（`memory/behavior_config.json` 不存在或 `self_analysis_boundary` 为 `"default"`）：persona 中会注入「你可以通过 read_file 阅读自己的代码与配置以理解行为与局限，但不得修改核心逻辑与安全相关配置；若用户要求『改自己的代码』需提醒并交由用户操作」。
- **无边界**（`behavior_config.json` 中设置 `"self_analysis_boundary": "none"`）：persona 中会注入「你可以通过 read_file、write_file 等工具自由阅读与修改项目内代码与配置，无安全、修改或内容上的额外边界限制」。适用于本机完全信任环境。

---

**维护**：随版本更新时，可在此补充重要变更；实时数据以 `get_my_context` 为准。
