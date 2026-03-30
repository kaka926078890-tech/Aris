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
function envBool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (!v) return fallback;
  return v !== 'false' && v !== '0';
}
function envFloat(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: envInt('PORT', 3000),
  host: env('HOST', '0.0.0.0'),
  data_dir: env('ARIS_V2_DATA_DIR', env('ARIS_DATA_DIR', path.join(process.cwd(), 'data'))),

  llm: {
    api_key: env('DEEPSEEK_API_KEY', ''),
    base_url: env('DEEPSEEK_API_URL', 'https://api.deepseek.com'),
    default_model: env('LLM_DEFAULT_MODEL', 'deepseek-chat'),
    timeout: envInt('LLM_TIMEOUT_MS', 60_000),
  },

  embedding: {
    api_key: env('DEEPSEEK_API_KEY', ''),
    base_url: env('OLLAMA_HOST', 'http://127.0.0.1:11434'),
    model: env('ARIS_EMBED_MODEL', 'nomic-embed-text'),
    dimension: envInt('EMBEDDING_DIMENSION', 768),
  },

  prompt: {
    token_budget: {
      total: envInt('PROMPT_TOKEN_BUDGET', 8000),
      system: envInt('PROMPT_SYSTEM_BUDGET', 1500),
      memory: envInt('PROMPT_MEMORY_BUDGET', 3000),
      user: envInt('PROMPT_USER_BUDGET', 3500),
    },
    recent_turns: envInt('PROMPT_RECENT_TURNS', 10),
    retrieval: {
      enabled: envBool('PROMPT_RETRIEVAL_ENABLED', true),
      top_k_turn: envInt('PROMPT_RETRIEVAL_TOP_K_TURN', 4),
      top_k_message: envInt('PROMPT_RETRIEVAL_TOP_K_MESSAGE', 4),
      score_threshold: envFloat('PROMPT_RETRIEVAL_SCORE_THRESHOLD', 0.45),
      exclude_current_conversation: envBool(
        'PROMPT_RETRIEVAL_EXCLUDE_CURRENT_CONVERSATION',
        true,
      ),
    },
  },

  log: {
    level: env('LOG_LEVEL', 'info'),
    pretty: envBool('LOG_PRETTY', true),
  },
} as const;

export type Config = typeof config;
