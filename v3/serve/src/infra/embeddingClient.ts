import OpenAI from 'openai';
import type { IEmbeddingClient } from '../types.js';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { EmbeddingError } from '../errors.js';

export class OpenAIEmbeddingClient implements IEmbeddingClient {
  private client: OpenAI;

  constructor() {
    const base = config.embedding.base_url.replace(/\/+$/, '');
    this.client = new OpenAI({
      apiKey: config.embedding.api_key || 'ollama',
      baseURL: base.endsWith('/v1') ? base : `${base}/v1`,
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
