# 项目目录与文档整理想法

## 一、当前状态与问题

### 1. 文档命名不统一
- **docs/** 内混用：全大写下划线（`VERIFICATION.md`）、全大写（`TASK_FLOW_AND_MULTIROUND_TOOLS.md`）、小写连字符（`agent-files-design.md`）、下划线（`self_upgrade_and_lowpower_solution.md`）等。
- **memory/** 内多为下划线或随意命名（`self_observation_log.md`、`emotional_records.md`）。
- 导致检索、引用、规范难以统一。

### 2. 文档与内容分散
- **根目录**：`README.md`、`TODO.md`。
- **docs/**：设计、架构、待办、验证、QA 等混在一起，缺少清晰分类。
- **memory/**：既有「Aris 运行时生成的内容」（如情感记录、操作日志），也有「项目侧备忘」（如 modification_history、expression_guide），职责边界不清。
- **src/** 下也有 md（如 `src/dialogue/persona.md`、`src/memory/aris_modification_history.md`），与 docs/memory 的划分容易混淆。

### 3. 项目规划类文件
- 规划、路线图、任务拆解分散在 `project-plan.md`、`todo.md`、`ARIS_TODO.md`、`continuity-implementation-tasks.md` 等，没有单一入口或分层（愿景 vs 迭代任务 vs 日常待办）。

---

## 二、整理思路（供后续落地参考）

### 1. 统一命名规范
- **所有文档（含 docs、memory、根目录下的 .md）**：统一为 **小写 + 连字符**（`lowercase-with-hyphens.md`）。
- 示例：`VERIFICATION.md` → `verification.md`，`self_upgrade_and_lowpower_solution.md` → `self-upgrade-and-lowpower-solution.md`。
- 已通过 Cursor rules 约定，新文档一律按此命名。

### 2. docs/ 内部分类建议
- **design/**：产品/交互/视觉设计、架构说明（如 `architecture.md`、`agent-files-design.md`）。
- **planning/**：项目愿景、路线图、版本规划（如 `project-plan.md`、`roadmap.md`）。
- **reference/**：技术参考、QA、验证清单（如 `verification.md`、`gemini-qa.md`、`terminal-and-git-tools.md`）。
- **decisions/**：重要方案与决策记录（如 `self-upgrade-and-lowpower-solution.md`、`memory-and-identity.md`）。
- 根级保留：`README.md`（索引）、`todo.md`（总待办）、`aris-todo.md`（Aris 专项待办）。

### 3. memory/ 职责边界
- **仅放 Aris 运行时生成/写入的内容**：情感记录、操作日志、对话摘要、自升级日志等（可由 Aris 或脚本写入）。
- **项目侧备忘、修改历史、表达指南等**：迁至 `docs/reference/` 或 `docs/decisions/`，避免与「记忆数据」混在一起。

### 4. 项目规划文件收敛
- **单一入口**：如 `docs/planning/README.md` 或根目录 `project-plan.md` 作为总览，内链到具体规划文档。
- **分层**：愿景/目标 → 版本与里程碑 → 具体任务/待办（可继续用 `todo.md`、`aris-todo.md` 或 issue 管理）。

---

## 三、Electron 页面技术栈说明

- **当前**：主窗口为 **纯 HTML + 内联/外部 CSS + 原生 JS**（经 esbuild 打包为 bundle.js），样式用 Tailwind CDN。无 Vue/React 等框架。
- **是否只能用 HTML**：否。Electron 的渲染进程本质是 Chromium，可接入任意前端技术栈。
- **Vue / 组件库**：可用。需要：
  - 在构建中引入 Vue（及 Vue Router 等），用 Vite/Webpack/esbuild 打包；
  - 若用 UI 组件库（如 Element Plus、Vuetify、Naive UI 等），需在 CSP 与打包配置中放行对应资源；
  - 与现有 Three.js / 对话 overlay 的集成需按「单页或多页」方式设计（例如对话区作为 Vue 根组件内的一块）。
- **建议**：若仅做小范围优化，保持现有 HTML + JS 即可；若计划做大界面改版或多页面/多组件，再引入 Vue + 组件库 并统一在 `src/renderer` 下用 Vue 重构。

---

## 四、滚动「慢放」问题与修复

- **原因**：对话区域容器 `#bubbles-wrap` 使用了 CSS `scroll-smooth`。每次流式追加内容后调用 `scrollToBottom()` 时，浏览器会对 `scrollTop` 做平滑动画，而内容仍在持续增加，视觉上就像滚动在「慢吞吞追赶」已渲染完的文字。
- **修复**：已从 `#bubbles-wrap` 上移除 `scroll-smooth`，改为瞬时滚动（直接 `scrollTop = scrollHeight`），加载与滚动一致，不再出现慢放感。

---

**文档创建时间**：2026-03  
**用途**：项目整理与规范参考，后续可按此思路逐步迁移和重命名，不必一次到位。
