# Aris v2

v2 为完整架构重构版本，与现网（项目根 `src/`）完全隔离。

- **后端**：`packages/server` + `packages/store`，不引用现有 `src/`。
- **前端**：`apps/renderer`，React + Tailwind + lucide-react，明亮风格。
- **数据**：使用 v2 独立数据目录（Electron userData/aris-v2 或 `v2/data`），与现有 Aris 数据分离。
- **记录**：身份、要求、纠错、情感、表达欲望仅由 LLM 通过工具写入，禁止代码内解析自动写入。

## 运行

```bash
cd v2
npm install   # 根目录安装即可，postinstall 会自动在 apps/renderer 安装前端依赖，无需再进 apps 执行 install
# 可选：复制 .env（或从项目根复制），配置 DEEPSEEK_API_KEY、OLLAMA_HOST 等
cp .env.example .env
# 启动 Electron（会加载 apps/renderer/index.html）
npm start
```

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

- [架构](docs/ARCHITECTURE.md)
- [提示词策略（方案 A）](docs/PROMPT-STRATEGY.md)
- [Store 层](docs/STORE.md)
- [向量设计](docs/VECTOR-DESIGN.md)
- [工具](docs/TOOLS.md)
- [分阶段执行清单](docs/todo.md)
