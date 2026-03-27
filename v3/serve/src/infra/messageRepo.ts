import { getDatabase } from './database.js';
import type { Message, Role, IMessageRepo } from '../types.js';

interface MessageRow {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  token_count: number | null;
  metadata_json: string | null;
}

export class MessageRepo implements IMessageRepo {
  create(
    conversationId: string,
    role: Role,
    content: string,
    tokenCount?: number,
    metadata?: Record<string, unknown>,
  ): Message {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const metaJson = metadata ? JSON.stringify(metadata) : null;

    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, created_at, token_count, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, conversationId, role, content, now, tokenCount ?? null, metaJson);

    db.prepare(
      'UPDATE conversations SET updated_at = ? WHERE id = ?',
    ).run(now, conversationId);

    return {
      id,
      conversationId,
      role,
      content,
      createdAt: now,
      tokenCount: tokenCount ?? null,
      metadata: metadata ?? null,
    };
  }

  findByConversation(
    conversationId: string,
    limit = 200,
    offset = 0,
  ): Message[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?',
      )
      .all(conversationId, limit, offset) as MessageRow[];
    return rows.map(toEntity);
  }

  findById(id: string): Message | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    return row ? toEntity(row) : null;
  }

  countByConversation(conversationId: string): number {
    const db = getDatabase();
    const row = db
      .prepare(
        'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?',
      )
      .get(conversationId) as { cnt: number };
    return row.cnt;
  }
}

function toEntity(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as Role,
    content: row.content,
    createdAt: row.created_at,
    tokenCount: row.token_count,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
  };
}
