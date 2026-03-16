# docs 文件夹整理总结

## 整理工作完成情况

### 1. 文件名统一
- **目标**：统一所有文件名格式，消除大小写混合和下划线/连字符不一致的问题
- **结果**：所有文件已统一为**全小写**，使用**连字符分隔单词**（kebab-case）

### 2. 重命名文件列表

#### 原大写文件 → 新小写文件
- `AGENT_FILES_DESIGN.md` → `agent-files-design.md`
- `ARCHITECTURE.md` → `architecture.md`
- `ARIS_TODO.md` → `aris-todo.md`
- `EMOTION_RECORD_ISSUES_AND_ANALYSIS.md` → `emotion-record-issues-and-analysis.md`
- `GEMINI_QA.md` → `gemini-qa.md`
- `MEMORY_AND_IDENTITY.md` → `memory-and-identity.md`
- `PROACTIVE_LOGIC.md` → `proactive-logic.md`
- `PROJECT_PLAN.md` → `project-plan.md`
- `TASK_FLOW_AND_MULTIROUND_TOOLS.md` → `task-flow-and-multiround-tools.md`
- `VERIFICATION.md` → `verification.md`
- `README.md` → `readme.md`

#### 原下划线文件 → 新连字符文件
- `git_operation_notes.md` → `git-operation-notes.md`
- `self_upgrade_and_lowpower_solution.md` → `self-upgrade-and-lowpower-solution.md`

#### 已符合规范的文件（未改动）
- `continuity-implementation-tasks.md`
- `identity-context-issue-analysis.md`
- `lianxu.md`
- `project-structure-and-conventions.md`
- `terminal-and-git-tools.md`
- `todo.md`

### 3. readme.md 更新
- 更新了所有文件的链接，确保指向正确的新文件名
- 添加了所有文档的完整索引

### 4. 当前 docs 文件夹结构
```
docs/
├── readme.md                            # 文档索引
├── project-plan.md                      # 项目愿景、视觉规范、技术栈、路线图
├── architecture.md                      # 技术架构：模块、存储、Prompt 分层、检索策略
├── memory-and-identity.md               # 记忆与身份：三层结构、身份文件、自成长与 Token 控制
├── gemini-qa.md                         # 硬设定 vs 软记忆（参考）、三层记忆架构建议
├── verification.md                      # 分步验证清单
├── aris-todo.md                         # 待办与备忘
├── agent-files-design.md                # Aris「自己文件夹」工具与流程设计
├── proactive-logic.md                   # 主动发话逻辑说明
├── task-flow-and-multiround-tools.md    # 任务流程与多轮工具调用
├── emotion-record-issues-and-analysis.md # 「改不动了」上下文来源排查说明
├── continuity-implementation-tasks.md   # 连续性实现任务
├── git-operation-notes.md               # Git 操作笔记
├── identity-context-issue-analysis.md   # 身份上下文问题分析
├── lianxu.md                            # 连续性相关文档
├── project-structure-and-conventions.md # 项目结构与约定
├── self-upgrade-and-lowpower-solution.md # 自升级与低功耗解决方案
├── terminal-and-git-tools.md            # 终端与 Git 工具
└── todo.md                              # 待办事项
```

### 5. 命名规范
- **格式**：全小写，使用连字符分隔单词（kebab-case）
- **示例**：`project-plan.md`、`memory-and-identity.md`、`git-operation-notes.md`
- **优势**：
  - 跨平台兼容性好（Windows 不区分大小写，Linux/macOS 区分）
  - 易于阅读和输入
  - 符合现代项目命名惯例

### 6. 后续建议
1. **新文档创建**：所有新文档都应遵循此命名规范
2. **代码引用更新**：如果代码中有硬编码引用这些文档文件，需要相应更新
3. **文档维护**：定期检查文档链接的有效性

---

**整理完成时间**：2026年3月12日  
**整理者**：Aris  
**使用能力**：多轮工具调用、文件读写操作