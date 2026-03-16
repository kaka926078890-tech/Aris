# v2 项目目录说明

```
v2/
├── package.json          # 根入口/workspace
├── README.md
├── .env.example
├── apps/
│   ├── electron/         # Electron 主进程（仅 v2）
│   └── renderer/         # React 前端（Vite + Tailwind + lucide，明亮风格）
├── packages/
│   ├── server/           # 对话、prompt、工具、LLM 调用
│   ├── store/            # 持久化多文件（identity, requirements, ...）
│   └── config/           # 路径与常量
├── data/                 # v2 运行时数据目录
└── docs/                 # 架构、策略、store、向量、工具、UI 管理、todo
```

v2 不引用项目根 `src/`，数据目录独立（如 v2/data 或 userData/aris-v2）。
