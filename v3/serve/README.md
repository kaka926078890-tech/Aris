# Aris v3 Serve

TypeScript + Fastify backend for Aris — chat with LLM API, persist conversation history and vector embeddings locally.

## Quick start

```bash
cd v3/serve
cp .env.example .env        # fill in LLM_API_KEY at minimum
npm install
npm run dev                  # starts on http://localhost:3000
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/chat` | Send a message, get assistant reply |
| GET | `/conversations` | List conversations |
| GET | `/conversations/:id` | Get conversation detail |
| GET | `/conversations/:id/messages` | Get message history |
| DELETE | `/conversations/:id` | Delete conversation |

### POST /chat

```json
{
  "message": "hello",
  "conversationId": "optional-existing-id",
  "model": "optional-model-override",
  "includeTrace": true
}
```

Response includes `conversationId`, `message`, `model`, and optional `trace` (prompt package with token usage and retrieval hits for debugging).

## Architecture

See `ARCHITECTURE.md` for full design rationale.

```
src/
  index.ts              ← entry point, wires all layers
  config.ts             ← typed env config
  logger.ts             ← pino logger
  errors.ts             ← structured error classes
  types.ts              ← all domain types & adapter interfaces

  infra/                ← external I/O adapters
    database.ts         ← SQLite + migration runner
    conversationRepo.ts ← conversation CRUD
    messageRepo.ts      ← message CRUD
    llmClient.ts        ← OpenAI-compatible chat
    embeddingClient.ts  ← OpenAI-compatible embeddings
    vectorStore.ts      ← local cosine similarity search
    embeddingQueue.ts   ← async background embedding

  app/                  ← business logic
    chatService.ts      ← main orchestrator
    promptBuilder.ts    ← prompt assembly
    promptPolicy.ts     ← configurable policies
    retrievalService.ts ← semantic recall

  api/                  ← HTTP layer
    server.ts           ← Fastify setup
    chatRoute.ts        ← POST /chat
    conversationRoute.ts ← conversation CRUD
```

## Configuration

All configurable via environment variables. See `.env.example` for full list with defaults.

Key settings:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_API_KEY` | (required) | API key for chat completions |
| `LLM_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible endpoint |
| `LLM_DEFAULT_MODEL` | `gpt-4o-mini` | Default chat model |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Embedding model |
| `ARIS_DATA_DIR` | `./data` | SQLite + data storage path |
| `RETRIEVAL_ENABLED` | `true` | Enable semantic memory recall |
| `PROMPT_RECENT_TURNS` | `10` | Recent turns to include in prompt |

## Scripts

```bash
npm run dev        # dev server with hot reload (tsx watch)
npm run build      # compile to dist/
npm run start      # run compiled output
npm run typecheck  # type-only check, no emit
```
