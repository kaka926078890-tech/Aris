export type Role = 'system' | 'user' | 'assistant';

// ── Domain entities ──

export interface Conversation {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: Role;
  content: string;
  createdAt: string;
  tokenCount: number | null;
  metadata: Record<string, unknown> | null;
}

// ── Prompt pipeline ──

export interface PromptMessage {
  role: Role;
  content: string;
}

export interface RetrievalHit {
  messageId: string;
  conversationId: string;
  role: Role;
  content: string;
  score: number;
}

export interface PromptPackage {
  messages: PromptMessage[];
  tokenUsage: {
    system: number;
    memory: number;
    user: number;
    total: number;
  };
  retrievalHits: RetrievalHit[];
}

export interface PromptPolicyConfig {
  tokenBudget: {
    total: number;
    system: number;
    memory: number;
    user: number;
  };
  retrieval: {
    enabled: boolean;
    topK: number;
    scoreThreshold: number;
  };
  recentTurns: number;
  systemTemplate: string;
  persona: string;
}

// ── API contract ──

export interface ChatRequest {
  conversationId?: string;
  message: string;
  model?: string;
  includeTrace?: boolean;
}

export interface ChatResponse {
  conversationId: string;
  message: Message;
  model: string;
  trace?: PromptPackage;
}

// ── Adapter interfaces (infrastructure boundary) ──

export interface ILLMClient {
  chat(
    messages: PromptMessage[],
    model?: string,
  ): Promise<{
    content: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
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
  messageId: string;
  conversationId: string;
}

export interface IVectorStore {
  upsert(id: string, vector: number[], metadata: VectorMeta): Promise<void>;
  query(
    vector: number[],
    topK: number,
    threshold?: number,
  ): Promise<Array<{ id: string; score: number; metadata: VectorMeta }>>;
  delete(id: string): Promise<void>;
}

export interface IConversationRepo {
  create(title?: string): Conversation;
  findById(id: string): Conversation | null;
  list(limit?: number, offset?: number): Conversation[];
  updateTitle(id: string, title: string): void;
  delete(id: string): void;
}

export interface IMessageRepo {
  create(
    conversationId: string,
    role: Role,
    content: string,
    tokenCount?: number,
    metadata?: Record<string, unknown>,
  ): Message;
  findByConversation(
    conversationId: string,
    limit?: number,
    offset?: number,
  ): Message[];
  findById(id: string): Message | null;
  countByConversation(conversationId: string): number;
}
