import { getDatabase } from './database.js';
import type { IVectorStore, VectorMeta } from '../types.js';
import { logger } from '../logger.js';

interface CacheEntry {
  id: string;
  vector: number[];
  metadata: VectorMeta;
}

interface EmbeddingRow {
  id: string;
  vector_json: string;
  message_id: string;
  conversation_id: string;
  source_kind: 'message' | 'turn';
  source_text: string;
  source_created_at: string;
}

/**
 * Local vector store backed by SQLite + in-memory cosine search.
 * Adapter interface allows swapping to pgvector / Qdrant without touching app code.
 */
export class LocalVectorStore implements IVectorStore {
  private cache = new Map<string, CacheEntry>();
  private loaded = false;

  private ensureCache(): void {
    if (this.loaded) return;

    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT
          e.id,
          e.vector_json,
          e.message_id,
          m.conversation_id,
          e.source_kind,
          e.source_text,
          m.created_at AS source_created_at
         FROM embeddings e
         JOIN messages m ON m.id = e.message_id`,
      )
      .all() as EmbeddingRow[];

    for (const row of rows) {
      this.cache.set(row.id, {
        id: row.id,
        vector: JSON.parse(row.vector_json),
        metadata: {
          message_id: row.message_id,
          conversation_id: row.conversation_id,
          source_kind: row.source_kind ?? 'message',
          source_text: row.source_text ?? '',
          source_created_at: row.source_created_at,
        },
      });
    }

    this.loaded = true;
    logger.info({ count: this.cache.size }, 'Vector cache loaded');
  }

  async upsert(
    id: string,
    vector: number[],
    metadata: VectorMeta,
  ): Promise<void> {
    this.ensureCache();
    const db = getDatabase();
    const json = JSON.stringify(vector);

    db.prepare(
      `INSERT INTO embeddings (id, message_id, model, dimension, vector_json, source_kind, source_text)
       VALUES (?, ?, 'default', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         vector_json = excluded.vector_json,
         source_kind = excluded.source_kind,
         source_text = excluded.source_text`,
    ).run(
      id,
      metadata.message_id,
      vector.length,
      json,
      metadata.source_kind,
      metadata.source_text,
    );

    this.cache.set(id, { id, vector, metadata });
  }

  async query(
    vector: number[],
    topK: number,
    threshold = 0.0,
    options?: {
      source_kinds?: Array<'message' | 'turn'>;
      conversation_id?: string;
    },
  ): Promise<Array<{ id: string; score: number; metadata: VectorMeta }>> {
    this.ensureCache();

    const qNorm = norm(vector);
    if (qNorm === 0) return [];

    const scored: Array<{
      id: string;
      score: number;
      metadata: VectorMeta;
    }> = [];

    for (const entry of this.cache.values()) {
      if (
        options?.conversation_id &&
        entry.metadata.conversation_id !== options.conversation_id
      ) {
        continue;
      }
      if (
        options?.source_kinds &&
        options.source_kinds.length > 0 &&
        !options.source_kinds.includes(entry.metadata.source_kind)
      ) {
        continue;
      }
      const score = cosine(vector, qNorm, entry.vector);
      if (score >= threshold) {
        scored.push({ id: entry.id, score, metadata: entry.metadata });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  async delete(id: string): Promise<void> {
    const db = getDatabase();
    db.prepare('DELETE FROM embeddings WHERE id = ?').run(id);
    this.cache.delete(id);
  }
}

function norm(v: number[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

function cosine(a: number[], aNorm: number, b: number[]): number {
  let dot = 0;
  let bSq = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    bSq += b[i] * b[i];
  }
  const bNorm = Math.sqrt(bSq);
  if (bNorm === 0) return 0;
  return dot / (aNorm * bNorm);
}
