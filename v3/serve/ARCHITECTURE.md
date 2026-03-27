# Aris v3 Backend Architecture

## Goal from first principles

The core product value is not "many features", but stable, high-quality conversation with memory continuity.
So the architecture should optimize for:

1. reliable answer quality,
2. explainable prompt assembly,
3. low-friction feature growth.

## Backend language decision

### MVP

- **TypeScript + Node.js + Fastify**
- **Reason**: fastest path to deliver because current Aris stack and team context already fit JS/Node.

### Final

- Keep TypeScript unless throughput and cost profiling prove a hard bottleneck.
- If bottleneck appears, move only hot paths (embedding batch jobs / retrieval workers) to Rust or Go as isolated services, not full rewrite.

## Capacity boundaries (current baseline)

Only two required abilities:

1. chat through API,
2. local storage of conversation + vector data.

Everything else should be optional plugins, not hardwired into the chat loop.

## Layered architecture

### 1) API Layer

- `POST /chat`: receive user input and return assistant output.
- `GET /conversations/:id/messages`: read local message history.
- `POST /conversations/:id/reindex`: rebuild vectors for old messages.

Responsibility: request validation, auth (if needed later), response shaping.

### 2) Application Layer (Orchestration)

- `ChatService`: one-turn orchestration.
- `PromptBuilder`: compose system + policy + memory snippets.
- `MemoryService`: store/retrieve structured conversation records.
- `RetrievalService`: semantic recall by vector search.

Responsibility: business flow, no storage engine details.

### 3) Domain Layer

- Entities: `Conversation`, `Message`, `MemoryChunk`, `EmbeddingVector`.
- Value objects: `Role`, `TokenBudget`, `PromptPackage`.
- Policies: truncation rules, retrieval thresholds, dedupe rules.

Responsibility: pure rules and invariants.

### 4) Infrastructure Layer

- LLM client adapter (OpenAI-compatible API).
- Embedding adapter.
- Local DB adapter.
- Local vector index adapter.

Responsibility: external I/O and concrete implementation.

## Prompt pipeline decomposition (explicit and inspectable)

For each turn:

1. **Input normalization**: sanitize role/content metadata.
2. **Memory recall**:
   - recent N turns (short-term),
   - top-K semantic hits (long-term vectors).
3. **Policy composition**:
   - persona baseline,
   - boundary/risk constraints,
   - optional runtime flags.
4. **Prompt packaging**:
   - system block,
   - memory block (trimmed by token budget),
   - user block.
5. **LLM call**.
6. **Persistence**:
   - append conversation messages,
   - embed and index new text asynchronously (or sync in MVP).

This keeps prompt behavior debuggable and prevents hidden coupling.

## Storage design

### MVP (simple + local-first)

- SQLite file for structured data.
- One local vector store implementation:
  - preferred: SQLite + vector extension,
  - fallback: lightweight file-based index with cosine search.

Tables (minimum):

- `conversations(id, title, created_at, updated_at)`
- `messages(id, conversation_id, role, content, created_at, token_count, metadata_json)`
- `message_embeddings(message_id, model, dimension, vector_blob, created_at)`

### Final (scalable)

- Keep data interfaces stable.
- Allow adapter swap:
  - SQLite -> Postgres,
  - local vector index -> pgvector / Qdrant / Milvus.
- Add migration + backfill workers.

## Suggested folder split

```txt
v3/serve/
  src/
    api/
      routes/
      schemas/
    app/
      chat/
      memory/
      retrieval/
      prompt/
    domain/
      entities/
      policies/
      types/
    infra/
      llm/
      embedding/
      db/
      vector/
    shared/
      config/
      logger/
      errors/
  docs/
    adr/
```

## MVP delivery plan

1. Build `POST /chat` end-to-end with plain prompt + API call.
2. Persist messages in local SQLite.
3. Add embedding generation for assistant/user messages.
4. Add top-K retrieval and inject into prompt.
5. Add trace log for prompt package and retrieval hits.

Exit criteria:

- Can start/reopen conversations.
- New turn can recall semantically related old content.
- Prompt payload is inspectable for debugging.

## Final architecture evolution

1. asynchronous embedding queue (reduce latency),
2. configurable prompt policy engine,
3. memory compaction and summarization pipeline,
4. multi-model routing (reasoning vs fast model),
5. observability: latency, token, retrieval quality dashboards,
6. plugin surface for tools and function calls.

## Non-goals (for now)

- no multi-tenant distributed architecture in phase 1,
- no premature microservice split,
- no giant static rule lists inside system prompt.

Keep the core loop small, inspectable, and replaceable.
