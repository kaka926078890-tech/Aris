# aris_v3_web

`web` 负责前端界面，后端接口对接到 `v3/serve`。

## 本地运行

1. 安装依赖
   - `npm install`
2. 配置接口地址
   - 复制 `.env.example` 为 `.env`
   - 默认：`VITE_API_BASE_URL=http://127.0.0.1:7899`
3. 启动
   - `npm run dev`
   - 访问 [http://127.0.0.1:7898](http://127.0.0.1:7898)

## 一键启动（推荐）

在项目根 `v3` 目录执行：

- `./start_all.sh`：启动 `ollama + serve + web`
- `./stop_all.sh`：停止由脚本拉起的进程
