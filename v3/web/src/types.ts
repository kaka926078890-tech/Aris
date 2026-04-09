export enum Panel {
  Chat = "chat",
  History = "history",
  VectorDB = "vectordb",
  UserAris = "useraris",
  Memory = "memory",
  Monitoring = "monitoring",
  Prompt = "prompt",
  Settings = "settings",
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  tool_trace?: ToolTraceRound[];
  thinking?: string;
}

export interface ChatApiRequest {
  message: string;
  conversation_id?: string;
}

export interface ChatApiResponse {
  conversation_id: string;
  message: {
    id: string;
    role: "assistant";
    content: string;
    created_at: string;
  };
  model: string;
  tool_trace: ToolTraceRound[];
}

export interface ToolTraceRound {
  round: number;
  used_tools: boolean;
  assistant_content: string;
  tool_calls: Array<{
    tool_name: string;
    tool_args: Record<string, unknown>;
    tool_result: Record<string, unknown>;
  }>;
  forced_text_only?: boolean;
}

export interface PromptMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface PromptPreviewResponse {
  conversation_id: string | null;
  trace: {
    messages: PromptMessage[];
    token_usage: {
      system: number;
      memory: number;
      user: number;
      total: number;
    };
  };
}

export interface ConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_preview: string | null;
  is_current: boolean;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant";
  content: string;
  created_at: string;
  token_count: number | null;
  metadata: Record<string, unknown> | null;
}

export interface VectorResult {
  id: string;
  type: string;
  summary: string;
  scores: {
    vector: number;
    typeWeight: number;
    timeDecay: number;
    keywordBonus: number;
    final: number;
  };
}

export interface TokenStat {
  id: string;
  time: string;
  session: string;
  type: string;
  input: number;
  output: number;
  hit: number;
  miss: number;
  hitRate: number;
  inference: number;
  estimated: boolean;
}

export interface FileChange {
  id: string;
  path: string;
  changes: number;
  lastModified: string;
}
