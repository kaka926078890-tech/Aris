export type Role = 'system' | 'user' | 'assistant';

// ── Domain entities ──

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationSummary extends Conversation {
  message_count: number;
  last_message_preview: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  created_at: string;
  token_count: number | null;
  metadata: Record<string, unknown> | null;
}

// ── 提示词打包 ──

export interface PromptMessage {
  role: Role | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface PromptPackage {
  messages: PromptMessage[];
  token_usage: {
    system: number;
    memory: number;
    user: number;
    total: number;
  };
}

export interface PromptPolicyConfig {
  token_budget: {
    total: number;
    system: number;
    memory: number;
    user: number;
  };
  recent_turns: number;
  retrieval: {
    enabled: boolean;
    top_k_turn: number;
    top_k_message: number;
    score_threshold: number;
    exclude_current_conversation: boolean;
    /** 每天衰减系数 λ，0 关闭 */
    time_decay_per_day: number;
  };
  compaction: {
    enabled: boolean;
    /** 尾部保留条数（user+assistant 消息条数，非轮次）；0 表示用 recent_turns*2 */
    tail_messages: number;
    token_trigger_ratio: number;
    prune_metadata_keep_last: number;
  };
  system_template: string;
  persona: string;
}

// ── API 协议 ──

export interface ChatRequest {
  conversation_id?: string;
  message: string;
  model?: string;
  include_trace?: boolean;
  /** 结构化指代：回复所针对的上一条消息 id（通常为 assistant） */
  reply_to_message_id?: string;
}

export interface ChatResponse {
  conversation_id: string;
  message: Message;
  model: string;
  tool_trace: ToolTraceRound[];
  trace?: PromptPackage;
}

export interface ChatPreviewRequest {
  conversation_id?: string;
  message: string;
  reply_to_message_id?: string;
}

export interface ChatPreviewResponse {
  conversation_id: string | null;
  trace: PromptPackage;
}

export interface ToolTraceCall {
  tool_name: string;
  tool_args: Record<string, unknown>;
  tool_result: Record<string, unknown>;
}

export interface ToolTraceRound {
  round: number;
  used_tools: boolean;
  assistant_content: string;
  tool_calls: ToolTraceCall[];
}

// ── 适配器接口（基础设施边界） ──

export interface ILLMClient {
  chat(
    messages: PromptMessage[],
    model?: string,
    tools?: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>,
  ): Promise<{
    content: string;
    model: string;
    prompt_tokens: number;
    completion_tokens: number;
    tool_calls: Array<{
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }>;
  }>;

  chat_stream?(
    messages: PromptMessage[],
    model?: string,
    tools?: Array<{
      type: 'function';
      function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
      };
    }>,
  ): AsyncGenerator<{
    delta: string;
    tool_calls: Array<{
      index?: number;
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
    model: string;
    /** 流式最后一包可能带整次请求的 usage（需请求含 stream_options.include_usage） */
    usage?: Record<string, unknown> | null;
  }>;
}

export interface IEmbeddingClient {
  embed(
    texts: string[],
  ): Promise<{
    vectors: number[][];
    model: string;
    dimension: number;
  }>;
}

export interface VectorMeta {
  message_id: string;
  conversation_id: string;
  source_kind: 'message' | 'turn';
  source_text: string;
  /** 对应 message 的 created_at（ISO），用于检索时间衰减 */
  source_created_at?: string;
}

export interface IVectorStore {
  upsert(id: string, vector: number[], metadata: VectorMeta): Promise<void>;
  query(
    vector: number[],
    topK: number,
    threshold?: number,
    options?: {
      source_kinds?: Array<'message' | 'turn'>;
      conversation_id?: string;
    },
  ): Promise<Array<{ id: string; score: number; metadata: VectorMeta }>>;
  delete(id: string): Promise<void>;
}

export interface IConversationRepo {
  create(title?: string): Conversation;
  find_by_id(id: string): Conversation | null;
  list(limit?: number, offset?: number): ConversationSummary[];
  get_current_id(): string | null;
  set_current_id(id: string | null): void;
  update_title(id: string, title: string): void;
  delete(id: string): void;
  delete_all(): void;
}

/** preferences.memory_kind，与 record 工具 payload.memory_kind 对齐 */
export type PreferenceMemoryKind =
  | 'preference'
  | 'interaction_feedback'
  | 'project_context'
  | 'reference_pointer';

export interface PreferenceEntry {
  id: string;
  topic: string;
  summary: string;
  source: string | null;
  tags: string[];
  created_at: string;
  memory_kind: PreferenceMemoryKind;
  description: string;
  why_context: string | null;
  how_to_apply: string | null;
  updated_at: string | null;
  expires_at: string | null;
}

export interface IRecordRepo {
  get_identity(): { name: string; notes: string; updated_at?: string } | null;
  set_identity(payload: { name?: string; notes?: string }): void;
  get_ignored_topics(): string[];
  set_ignored_topics(topics: string[]): void;
  add_preference(payload: {
    topic: string;
    summary: string;
    source?: string;
    tags?: string[];
    memory_kind?: PreferenceMemoryKind;
    description?: string;
    why_context?: string;
    how_to_apply?: string;
    expires_at?: string | null;
  }): string;
  /** 全量或按 topic 列（get_record）；不过滤 inject 策略 */
  list_preferences(topic?: string, limit?: number): PreferenceEntry[];
  /** 按 memory_kind 过滤（get_record 可选） */
  list_preferences_by_memory_kinds(kinds: string[], limit: number): PreferenceEntry[];
  /** 仅注入进窗：preference + 未过期 project_context */
  list_preferences_for_prompt(limit: number): PreferenceEntry[];
  add_correction(payload: {
    previous: string;
    correction: string;
    why_context?: string;
  }): string;
  list_corrections(limit?: number): Array<{
    id: string;
    previous: string;
    correction: string;
    created_at: string;
    why_context: string | null;
  }>;
}

export interface IMessageRepo {
  create(
    conversation_id: string,
    role: Role,
    content: string,
    token_count?: number,
    metadata?: Record<string, unknown>,
  ): Message;
  find_by_conversation(
    conversation_id: string,
    limit?: number,
    offset?: number,
    order?: 'asc' | 'desc',
  ): Message[];
  find_by_id(id: string): Message | null;
  count_by_conversation(conversation_id: string): number;
}
