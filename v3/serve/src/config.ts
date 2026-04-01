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
  port: envInt('PORT', 7899),
  host: env('HOST', '0.0.0.0'),
  data_dir: env('ARIS_V2_DATA_DIR', env('ARIS_DATA_DIR', path.join(process.cwd(), 'data'))),

  llm: {
    api_key: env('DEEPSEEK_API_KEY', ''),
    base_url: env('DEEPSEEK_API_URL', 'https://api.deepseek.com'),
    default_model: env('LLM_DEFAULT_MODEL', 'deepseek-chat'),
    timeout: envInt('LLM_TIMEOUT_MS', 60_000),
    /** 流式结束时请求 usage（OpenAI 兼容）；若对端报错可设 false） */
    stream_include_usage: envBool('ARIS_LLM_STREAM_INCLUDE_USAGE', true),
  },

  embedding: {
    api_key: env('DEEPSEEK_API_KEY', ''),
    base_url: env('OLLAMA_HOST', 'http://127.0.0.1:11434'),
    model: env('ARIS_EMBED_MODEL', 'nomic-embed-text'),
    dimension: envInt('EMBEDDING_DIMENSION', 768),
  },

  web: {
    enabled: envBool('ARIS_WEB_TOOLS_ENABLED', true),
    search_api_url: env('ARIS_WEB_SEARCH_API_URL', 'https://api.tavily.com/search'),
    search_api_key: env('ARIS_WEB_SEARCH_API_KEY', ''),
    search_max_results: envInt('ARIS_WEB_SEARCH_MAX_RESULTS', 5),
    fetch_timeout_ms: envInt('ARIS_WEB_FETCH_TIMEOUT_MS', 12_000),
    fetch_max_chars: envInt('ARIS_WEB_FETCH_MAX_CHARS', 12_000),
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
      /** 按消息距今天数衰减检索分：final = score * exp(-days * λ)；0 表示关闭 */
      time_decay_per_day: envFloat('PROMPT_RETRIEVAL_TIME_DECAY_PER_DAY', 0),
    },
    /** OpenClaw 式：transcript 全量落库，进窗时 compaction + 尾部原文 + 元数据裁剪 */
    compaction: {
      enabled: envBool('PROMPT_COMPACTION_ENABLED', true),
      /** 0 表示使用 PROMPT_RECENT_TURNS*2 条消息作为尾部保留 */
      tail_messages: envInt('PROMPT_COMPACTION_TAIL_MESSAGES', 0),
      token_trigger_ratio: envFloat('PROMPT_COMPACTION_TOKEN_TRIGGER_RATIO', 0.85),
      prune_metadata_keep_last: envInt('PROMPT_COMPACTION_PRUNE_METADATA_KEEP_LAST', 8),
    },
  },

  log: {
    level: env('LOG_LEVEL', 'info'),
    pretty: envBool('LOG_PRETTY', true),
    /** true 时在终端打印完整 messages 内容（调试）；默认仅摘要条数与字符量 */
    debug_llm_request_body: envBool('ARIS_DEBUG_LLM_REQUEST_BODY', false),
  },
} as const;

export type Config = typeof config;
