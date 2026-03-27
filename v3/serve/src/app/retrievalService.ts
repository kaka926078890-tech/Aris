import type {
  IEmbeddingClient,
  IVectorStore,
  IMessageRepo,
  RetrievalHit,
  PromptPolicyConfig,
} from '../types.js';
import { logger } from '../logger.js';

export class RetrievalService {
  constructor(
    private embeddingClient: IEmbeddingClient,
    private vectorStore: IVectorStore,
    private messageRepo: IMessageRepo,
  ) {}

  async retrieve(
    query: string,
    policy: PromptPolicyConfig,
    excludeMessageIds?: Set<string>,
  ): Promise<RetrievalHit[]> {
    if (!policy.retrieval.enabled) return [];

    try {
      const { vectors } = await this.embeddingClient.embed([query]);
      if (vectors.length === 0) return [];

      const raw = await this.vectorStore.query(
        vectors[0],
        policy.retrieval.topK * 2,
        policy.retrieval.scoreThreshold,
      );

      const hits: RetrievalHit[] = [];
      for (const r of raw) {
        if (excludeMessageIds?.has(r.metadata.messageId)) continue;
        const msg = this.messageRepo.findById(r.metadata.messageId);
        if (!msg) continue;
        hits.push({
          messageId: msg.id,
          conversationId: msg.conversationId,
          role: msg.role,
          content: msg.content,
          score: r.score,
        });
        if (hits.length >= policy.retrieval.topK) break;
      }

      logger.debug(
        { query: query.slice(0, 80), hitCount: hits.length },
        'Retrieval complete',
      );
      return hits;
    } catch (err) {
      logger.warn({ err }, 'Retrieval failed, continuing without recall');
      return [];
    }
  }
}
