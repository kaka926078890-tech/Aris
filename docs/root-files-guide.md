# 根目录文件说明与规划

## 各文件用途

| 文件 | 用途 | 是否必须放在根目录 |
|------|------|---------------------|
| **package.json** | 项目元数据、依赖、npm 脚本（start/build）。 | 是，npm 约定。 |
| **package-lock.json** | 锁定依赖版本。 | 是，npm 约定。 |
| **electron.main.js** | Electron 主进程入口，创建窗口、IPC、菜单。`package.json` 的 `"main"` 指向它。 | 是，Electron 约定。 |
| **electron-builder.config.js** | 打包配置（dmg/zip/nsis、打包包含哪些文件）。 | 通常放根目录，可放 `config/` 并改 package.json 引用。 |
| **build.renderer.js** | 用 esbuild 把 `src/renderer/main.js` 打成 `src/renderer/dist/bundle.js`。 | 可移入 `scripts/`，需改 package.json 的 `build:renderer`。 |
| **preload.js** | 主窗口（对话 HUD）预加载脚本，向渲染进程暴露 `window.aris`（发消息、收 chunk、主动消息等）。 | 主进程用 `path.join(__dirname, 'preload.js')` 加载，可放根或 `preload/`。 |
| **preload.history.js** | 历史会话窗口预加载，暴露 `window.historyApi`（会话列表、对话内容、清空）。 | 同上，对应历史窗口。 |
| **preload.memory.js** | 记忆管理窗口预加载，暴露 `window.memoryApi`（统计、列表、语义搜索、重建索引、清空）。 | 同上，对应记忆窗口。 |
| **preload.prompt.js** | 提示词预览窗口预加载，暴露 `window.promptApi`（根据用户输入生成预览）。 | 同上，对应提示词窗口。 |
| **README.md** | 项目说明。 | 惯例在根目录。 |
| **TODO.md** | 待办。与 `docs/aris-todo.md` 重复时可删根目录，只保留 docs 内一份。 | 可删或合并到 docs。 |

## 已做整理

- **TODO.md**：根目录已删除，待办统一用 `docs/aris-todo.md`。
- **test_identity_context.js**：为单次调试「身份/上下文」的脚本，已移至 `scripts/test_identity_context.js`，需要时在项目根执行：`node scripts/test_identity_context.js`。
- **build.renderer.js**：已移至 `scripts/build.renderer.js`，package.json 的 `build:renderer` 已改为调用该路径。
- **electron-builder**：打包配置已补全四个 preload（`preload.js`、`preload.history.js`、`preload.memory.js`、`preload.prompt.js`），避免打包后副窗口缺少 preload。

## 可选规划（未改）

- **preload 集中到子目录**：建 `preload/`，放入四个 preload 文件，主进程里改为 `path.join(__dirname, 'preload', 'preload.js')` 等，并同步改 `electron-builder.config.js` 的 `files`。根目录会更干净，但需改多处路径。
- **electron-builder 配置**：若要统一放配置，可建 `config/electron-builder.config.js`，在 package.json 的 build 脚本里用 `--config config/electron-builder.config.js`。
