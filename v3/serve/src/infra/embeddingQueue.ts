import { EventEmitter } from 'node:events';
import type { IEmbeddingClient, IVectorStore } from '../types.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

interface EmbeddingJob {
  id: string;
  messageId: string;
  conversationId: string;
  text: string;
  attempt: number;
}

/**
 * In-process async queue that embeds messages in the background after each turn.
 * Swappable to Bull / BullMQ / SQS for production multi-worker setups.
 */
export class EmbeddingQueue extends EventEmitter {
  private queue: EmbeddingJob[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly retryDelay: number;

  constructor(
    private embeddingClient: IEmbeddingClient,
    private vectorStore: IVectorStore,
  ) {
    super();
    this.concurrency = config.queue.concurrency;
    this.maxRetries = config.queue.retryAttempts;
    this.retryDelay = config.queue.retryDelay;
  }

  enqueue(
    messageId: string,
    conversationId: string,
    text: string,
  ): void {
    const id = crypto.randomUUID();
    this.queue.push({ id, messageId, conversationId, text, attempt: 0 });
    logger.debug(
      { messageId, queueSize: this.queue.length },
      'Embedding job enqueued',
    );
    this.drain();
  }

  get pending(): number {
    return this.queue.length + this.active;
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.active++;
      this.process(job).finally(() => {
        this.active--;
        this.drain();
      });
    }
  }

  private async process(job: EmbeddingJob): Promise<void> {
    try {
      const { vectors } = await this.embeddingClient.embed([job.text]);
      if (vectors.length > 0) {
        await this.vectorStore.upsert(job.id, vectors[0], {
          messageId: job.messageId,
          conversationId: job.conversationId,
        });
      }
      logger.debug({ messageId: job.messageId }, 'Embedding stored');
      this.emit('completed', job);
    } catch (err) {
      job.attempt++;
      if (job.attempt < this.maxRetries) {
        logger.warn(
          { messageId: job.messageId, attempt: job.attempt, err },
          'Embedding failed, scheduling retry',
        );
        setTimeout(() => {
          this.queue.push(job);
          this.drain();
        }, this.retryDelay * job.attempt);
      } else {
        logger.error(
          { messageId: job.messageId, err },
          'Embedding permanently failed after retries',
        );
        this.emit('failed', job, err);
      }
    }
  }
}
