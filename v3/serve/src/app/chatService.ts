import type {
  ILLMClient,
  IConversationRepo,
  IMessageRepo,
  ChatRequest,
  ChatResponse,
  PromptPolicyConfig,
} from '../types.js';
import { PromptBuilder } from './promptBuilder.js';
import { RetrievalService } from './retrievalService.js';
import type { EmbeddingQueue } from '../infra/embeddingQueue.js';
import { loadPromptPolicy } from './promptPolicy.js';
import { NotFoundError } from '../errors.js';
import { logger } from '../logger.js';

export class ChatService {
  private policy: PromptPolicyConfig;
  private promptBuilder: PromptBuilder;

  constructor(
    private llmClient: ILLMClient,
    private conversationRepo: IConversationRepo,
    private messageRepo: IMessageRepo,
    private retrievalService: RetrievalService,
    private embeddingQueue: EmbeddingQueue,
  ) {
    this.policy = loadPromptPolicy();
    this.promptBuilder = new PromptBuilder();
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    // 1 — Resolve or create conversation
    let conversation = req.conversationId
      ? this.conversationRepo.findById(req.conversationId)
      : null;

    if (req.conversationId && !conversation) {
      throw new NotFoundError('Conversation', req.conversationId);
    }
    if (!conversation) {
      conversation = this.conversationRepo.create();
    }

    // 2 — Persist user message
    const userMsg = this.messageRepo.create(
      conversation.id,
      'user',
      req.message,
    );

    // 3 — Semantic recall (exclude recent turns to avoid redundancy)
    const recentMessages = this.messageRepo.findByConversation(
      conversation.id,
      this.policy.recentTurns * 2,
    );
    const recentIds = new Set(recentMessages.map((m) => m.id));

    const retrievalHits = await this.retrievalService.retrieve(
      req.message,
      this.policy,
      recentIds,
    );

    // 4 — Build prompt (recent history minus the just-inserted user msg)
    const history = recentMessages.filter((m) => m.id !== userMsg.id);
    const promptPackage = this.promptBuilder.build(
      this.policy,
      history,
      retrievalHits,
      req.message,
    );

    logger.info(
      {
        conversationId: conversation.id,
        tokenUsage: promptPackage.tokenUsage,
        retrievalHitCount: retrievalHits.length,
      },
      'Prompt assembled',
    );

    // 5 — Call LLM
    const llmRes = await this.llmClient.chat(
      promptPackage.messages,
      req.model,
    );

    // 6 — Persist assistant message
    const assistantMsg = this.messageRepo.create(
      conversation.id,
      'assistant',
      llmRes.content,
      llmRes.completionTokens,
    );

    // 7 — Auto-title on first exchange
    if (this.messageRepo.countByConversation(conversation.id) <= 2) {
      this.conversationRepo.updateTitle(
        conversation.id,
        req.message.slice(0, 100),
      );
    }

    // 8 — Async embedding (non-blocking)
    this.embeddingQueue.enqueue(
      userMsg.id,
      conversation.id,
      req.message,
    );
    this.embeddingQueue.enqueue(
      assistantMsg.id,
      conversation.id,
      llmRes.content,
    );

    return {
      conversationId: conversation.id,
      message: assistantMsg,
      model: llmRes.model,
      trace: req.includeTrace ? promptPackage : undefined,
    };
  }
}
