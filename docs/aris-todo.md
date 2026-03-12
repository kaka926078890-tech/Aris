# Aris 待办与备忘

## 记忆 / 向量

- **分块逻辑**：当前暂不做分块。每回对话内容较短（用户约 300、Aris 约 500 字），不超 embedding 上下文。若后续支持长文档或超长单条，再加分块（chunk_size、overlap 等）与相关配置。

- **文件操作记忆优化**：当前只存「自然语言描述 + 内容摘要」到 `aris_file_operation`。最终方案：存储时包含 **操作工具 + 参数 + 内容摘要**，向量化也用这段内容；实现位置 `handler.js` 的 `recordFileOperationMemories()`；内容摘要需做长度限制（如 200 字）省 token。
