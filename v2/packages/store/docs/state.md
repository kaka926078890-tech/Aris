# state.js

- **职责**：运行状态（上次活跃时间、心理状态、任务账本 task_ledger、proactive 状态等）。
- **接口**：`readState()`、`writeState(updates)`、`readProactiveState()`、`writeProactiveState(updates)`。
- **存储**：aris_state.json、aris_proactive_state.json（v2 数据目录）。
