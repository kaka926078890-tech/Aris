# Aris v3 Serve

This folder hosts the new Aris v3 backend service.

## Current scope (MVP)

1. Connect to an LLM API for chat completion.
2. Persist local conversation history.
3. Persist and retrieve vector embeddings locally.

## Suggested backend language

Use TypeScript (Node.js) as the default choice.

Why:

- Existing Aris codebase is JavaScript/Node-oriented, so migration cost is lowest.
- Fast iteration speed for prompt and orchestration changes.
- Strong ecosystem for HTTP services, embedding clients, and local persistence.
- Good long-term maintainability with type safety and clear module contracts.

## v3 architecture docs

See `ARCHITECTURE.md` for:

- clear module boundaries,
- prompt pipeline decomposition,
- MVP vs final architecture,
- incremental roadmap.
