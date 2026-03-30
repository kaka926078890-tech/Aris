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
    conversation_id: string,
    role: Role,
    content: string,
    token_count?: number,
    metadata?: Record<string, unknown>,
  ): Message {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const metaJson = metadata ? JSON.stringify(metadata) : null;

    db.prepare(
      `INSERT INTO messages (id, conversation_id, role, content, created_at, token_count, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, conversation_id, role, content, now, token_count ?? null, metaJson);

    db.prepare(
      'UPDATE conversations SET updated_at = ? WHERE id = ?',
    ).run(now, conversation_id);

    return {
      id,
      conversation_id,
      role,
      content,
      created_at: now,
      token_count: token_count ?? null,
      metadata: metadata ?? null,
    };
  }

  find_by_conversation(
    conversation_id: string,
    limit = 200,
    offset = 0,
    order: 'asc' | 'desc' = 'asc',
  ): Message[] {
    const db = getDatabase();
    const orderBy = order === 'desc' ? 'DESC' : 'ASC';
    const rows = db
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ${orderBy}, id ${orderBy}
         LIMIT ? OFFSET ?`,
      )
      .all(conversation_id, limit, offset) as MessageRow[];
    return rows.map(toEntity);
  }

  find_by_id(id: string): Message | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(id) as MessageRow | undefined;
    return row ? toEntity(row) : null;
  }

  count_by_conversation(conversation_id: string): number {
    const db = getDatabase();
    const row = db
      .prepare(
        'SELECT COUNT(*) as cnt FROM messages WHERE conversation_id = ?',
      )
      .get(conversation_id) as { cnt: number };
    return row.cnt;
  }
}

function toEntity(row: MessageRow): Message {
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role as Role,
    content: row.content,
    created_at: row.created_at,
    token_count: row.token_count,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
  };
}
