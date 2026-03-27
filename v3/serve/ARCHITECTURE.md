# Aris v3 Backend Architecture

## Design principle

The core product value is stable, high-quality conversation with memory continuity.
Architecture optimises for: reliable answer quality → explainable prompt assembly → low-friction feature growth.

## Language & framework

**TypeScript + Node.js + Fastify**

- Current Aris stack is Node; lowest migration cost.
- The hard problem is prompt orchestration and memory recall, not raw throughput.
- If profiling reveals a hot path, move only that slice (embedding batch worker) to Rust/Go as an isolated service.

## Layered architecture

```
┌──────────────────────────────────────┐
│  API Layer  (Fastify routes)         │  ← HTTP, validation, error shaping
├──────────────────────────────────────┤
│  Application Layer                   │  ← ChatService, PromptBuilder,
│  (orchestration, no I/O details)     │    RetrievalService, EmbeddingQueue
├──────────────────────────────────────┤
│  Domain Types & Policies             │  ← Entities, token budgets, policy config
├──────────────────────────────────────┤
│  Infrastructure Layer                │  ← LLM client, embedding client,
│  (adapters, swappable)               │    SQLite DB, local vector store
└──────────────────────────────────────┘
```

## Prompt pipeline (per turn)

1. **Input** — user message arrives via `POST /chat`.
2. **Memory recall** — recent N turns (short-term) + top-K semantic hits from vector store (long-term).
3. **Policy composition** — persona baseline + boundary constraints + retrieval context, governed by `PromptPolicyConfig`.
4. **Prompt packaging** — `PromptBuilder` assembles system/memory/user blocks within token budget.
5. **LLM call** — OpenAI-compatible API via `ILLMClient` adapter.
6. **Persistence** — user + assistant messages stored in SQLite; embeddings enqueued asynchronously.

The entire prompt payload is inspectable via `includeTrace: true` in the chat request.

## Storage design

**SQLite (local-first, single file)**

Tables:
- `conversations(id, title, created_at, updated_at)`
- `messages(id, conversation_id, role, content, created_at, token_count, metadata_json)`
- `embeddings(id, message_id, model, dimension, vector_json, created_at)`

Vectors stored as JSON arrays in SQLite. In-memory cache loaded on first query for cosine similarity search.

**Adapter swap path**: keep `IConversationRepo`, `IMessageRepo`, `IVectorStore` interfaces stable → swap SQLite → Postgres, local vectors → pgvector/Qdrant, with zero app-layer changes.

## Async embedding queue

`EmbeddingQueue` processes embeddings in background after each turn:
- Configurable concurrency and retry policy.
- Does not block the chat response.
- Swap to Bull/BullMQ for multi-worker production setups.

## Implemented modules

```
src/
  index.ts              — entry, wires all layers
  config.ts             — typed env config with defaults
  logger.ts             — pino logger
  errors.ts             — AppError, NotFoundError, LLMError, EmbeddingError
  types.ts              — all domain types + adapter interfaces

  infra/
    database.ts         — SQLite + migration runner (WAL mode, foreign keys)
    conversationRepo.ts — IConversationRepo impl
    messageRepo.ts      — IMessageRepo impl
    llmClient.ts        — OpenAI-compatible ILLMClient
    embeddingClient.ts  — OpenAI-compatible IEmbeddingClient
    vectorStore.ts      — IVectorStore with in-memory cosine search
    embeddingQueue.ts   — async background embedding with retries

  app/
    chatService.ts      — main orchestrator (1 turn = retrieve → build → call → persist → embed)
    promptBuilder.ts    — token-budgeted prompt assembly
    promptPolicy.ts     — policy config + token estimator
    retrievalService.ts — embed query → vector search → hydrate messages

  api/
    server.ts           — Fastify setup, CORS, error handler
    chatRoute.ts        — POST /chat
    conversationRoute.ts— conversation CRUD + message listing
```

## Evolution roadmap

1. **Configurable prompt policy engine** — load persona/template from file or DB, hot-reload.
2. **Memory compaction** — summarise old turns to fit more history in budget.
3. **Multi-model routing** — fast model for simple turns, reasoning model for complex ones.
4. **Observability** — latency, token, retrieval quality dashboards.
5. **Plugin surface** — tool/function-call registration for extensibility.
6. **Storage scaling** — swap SQLite → Postgres + pgvector when data outgrows single-node.

## Non-goals (current phase)

- No multi-tenant / distributed architecture.
- No premature microservice split.
- No giant static rule lists in system prompt.
