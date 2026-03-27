import OpenAI from 'openai';
import type { IEmbeddingClient } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { EmbeddingError } from '../errors.js';

export class OpenAIEmbeddingClient implements IEmbeddingClient {
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({
      apiKey: config.embedding.apiKey,
      baseURL: config.embedding.baseUrl,
    });
  }

  async embed(texts: string[]) {
    if (texts.length === 0) {
      return {
        vectors: [],
        model: config.embedding.model,
        dimension: config.embedding.dimension,
      };
    }

    try {
      const res = await this.client.embeddings.create({
        model: config.embedding.model,
        input: texts,
        dimensions: config.embedding.dimension,
      });

      const vectors = res.data
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);

      logger.debug(
        { count: texts.length, model: res.model },
        'Embeddings generated',
      );

      return {
        vectors,
        model: res.model,
        dimension: vectors[0]?.length ?? config.embedding.dimension,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'Embedding call failed');
      throw new EmbeddingError(`Embedding failed: ${msg}`);
    }
  }
}
