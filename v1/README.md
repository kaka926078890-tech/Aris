# Aris v1（归档）

此目录为 v1 版本代码归档，主版本请使用仓库根目录下的 **v2**（参见根目录 README.md）。

---

# Aris (Alpha)

Desktop AI companion: HUD-style visual (outer ring, square frame, Plexus core), INFP personality, local vector memory (LanceDB), and proactive dialogue.

## Requirements

- Node.js 18+
- **DeepSeek API key** for dialogue (set `DEEPSEEK_API_KEY`)
- **Ollama** with `nomic-embed-text` for local embeddings (optional; memory works better with it)

## Setup

```bash
npm install
cp .env.example .env
# Edit .env: set DEEPSEEK_API_KEY
```

## Run

```bash
npm start
```

- Click the **center** of the 3D view to open the dialogue panel and type a message.
- Aris may **proactively** send a message every few minutes (state-driven, no fixed rules).

## Build (packaged app)

```bash
npm run build
```

## Data

- **SQLite**: `userData/aris/aris.db` (conversations, settings)
- **LanceDB**: `userData/aris/lancedb/` (vector memory)

API keys are read from the environment only (main process); they are not embedded in the frontend.
