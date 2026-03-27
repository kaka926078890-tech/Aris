import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv();

function env(key: string, fallback: string): string {
  return process.env[key] || fallback;
}
function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseInt(v, 10) : fallback;
}
function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  return v ? parseFloat(v) : fallback;
}
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v !== 'false' && v !== '0';
}

export const config = {
  port: envInt('PORT', 3000),
  host: env('HOST', '0.0.0.0'),
  dataDir: env('ARIS_DATA_DIR', path.join(process.cwd(), 'data')),

  llm: {
    apiKey: env('LLM_API_KEY', ''),
    baseUrl: env('LLM_BASE_URL', 'https://api.openai.com/v1'),
    defaultModel: env('LLM_DEFAULT_MODEL', 'gpt-4o-mini'),
    reasoningModel: env('LLM_REASONING_MODEL', ''),
    timeout: envInt('LLM_TIMEOUT_MS', 60_000),
  },

  embedding: {
    apiKey: env('EMBEDDING_API_KEY', '') || env('LLM_API_KEY', ''),
    baseUrl: env('EMBEDDING_BASE_URL', '') || env('LLM_BASE_URL', 'https://api.openai.com/v1'),
    model: env('EMBEDDING_MODEL', 'text-embedding-3-small'),
    dimension: envInt('EMBEDDING_DIMENSION', 1536),
    batchSize: envInt('EMBEDDING_BATCH_SIZE', 20),
  },

  prompt: {
    tokenBudget: {
      total: envInt('PROMPT_TOKEN_BUDGET', 8000),
      system: envInt('PROMPT_SYSTEM_BUDGET', 1500),
      memory: envInt('PROMPT_MEMORY_BUDGET', 3000),
      user: envInt('PROMPT_USER_BUDGET', 3500),
    },
    recentTurns: envInt('PROMPT_RECENT_TURNS', 10),
    retrieval: {
      enabled: envBool('RETRIEVAL_ENABLED', true),
      topK: envInt('RETRIEVAL_TOP_K', 5),
      scoreThreshold: envFloat('RETRIEVAL_SCORE_THRESHOLD', 0.7),
    },
  },

  queue: {
    concurrency: envInt('EMBEDDING_QUEUE_CONCURRENCY', 2),
    retryAttempts: envInt('EMBEDDING_QUEUE_RETRIES', 3),
    retryDelay: envInt('EMBEDDING_QUEUE_RETRY_DELAY_MS', 1000),
  },

  log: {
    level: env('LOG_LEVEL', 'info'),
    pretty: envBool('LOG_PRETTY', false),
  },
} as const;

export type Config = typeof config;
