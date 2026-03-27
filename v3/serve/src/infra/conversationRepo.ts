import { getDatabase } from './database.js';
import type { Conversation, IConversationRepo } from '../types.js';

interface ConversationRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export class ConversationRepo implements IConversationRepo {
  create(title?: string): Conversation {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(id, title ?? null, now, now);
    return { id, title: title ?? null, createdAt: now, updatedAt: now };
  }

  findById(id: string): Conversation | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as ConversationRow | undefined;
    return row ? toEntity(row) : null;
  }

  list(limit = 50, offset = 0): Conversation[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        'SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ? OFFSET ?',
      )
      .all(limit, offset) as ConversationRow[];
    return rows.map(toEntity);
  }

  updateTitle(id: string, title: string): void {
    const db = getDatabase();
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(title, id);
  }

  delete(id: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }
}

function toEntity(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
