# Aris v2

v2 为完整架构重构版本，与现网（项目根 `src/`）完全隔离。

- **后端**：`packages/server` + `packages/store`，不引用现有 `src/`。
- **前端**：`apps/renderer`，React + Tailwind + lucide-react，明亮风格。
- **数据**：使用 v2 独立数据目录（Electron userData/aris-v2 或 `v2/data`），与现有 Aris 数据分离。
- **记录**：身份、要求、纠错、情感、表达欲望仅由 LLM 通过工具写入，禁止代码内解析自动写入。

## 配置

- **开发/本地**：可复制 `.env.example` 为 `.env`，配置 `DEEPSEEK_API_KEY`、`DEEPSEEK_API_URL`、`OLLAMA_HOST` 等。
- **打包分发**：无需 .env。安装后打开应用，在侧栏进入 **设置** 页填写 DeepSeek API Key 与 API 地址（可选），保存即可。设置会写入 Electron userData 目录，下次启动自动生效。
- **Ollama**：对话不依赖 Ollama；仅需「语义记忆/向量检索」时可选安装 [Ollama](https://ollama.com) 并执行 `ollama pull nomic-embed-text`，设置页有说明。

## 运行

```bash
cd v2
npm install   # 根目录安装即可，postinstall 会自动在 apps/renderer 安装前端依赖
# 可选：复制 .env 配置 DEEPSEEK_API_KEY 等；也可启动后在应用内「设置」页配置
cp .env.example .env
npm start
```

## 打包

```bash
cd v2
npm install
npm run build       # 按当前平台打包（Mac / Windows / Linux）
# 或指定平台
npm run build:mac   # 产出 dmg、zip（macOS）
npm run build:win   # 产出 nsis 安装包、portable（Windows）
npm run build:linux # 产出 AppImage（Linux）
```

产出目录：`v2/dist/`。

### 常见问题

- **`npm start` 报错：`'electron' 不是内部或外部命令`**
  - **原因**：当前环境还没有在 `v2` 目录安装依赖（尤其是 `electron`），或安装过程未完成。
  - **解决方式**：
    - 确认在 `v2` 目录执行过一次完整的依赖安装：
      ```bash
      cd v2
      npm install
      ```
    - 安装完成后重新执行：
      ```bash
      npm start
      ```

## 文档

- [架构](docs/architecture.md)
- [提示词策略（方案 A）](docs/prompt_strategy.md)
- [Store 层](docs/store.md)
- [向量设计](docs/vector_design.md)
- [工具](docs/tools.md)
- [分阶段执行清单](docs/todo.md)
