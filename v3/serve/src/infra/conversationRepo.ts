import { getDatabase } from './database.js';
import type {
  Conversation,
  ConversationSummary,
  IConversationRepo,
} from '../types.js';

interface ConversationRow {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface ConversationSummaryRow extends ConversationRow {
  message_count: number;
  last_message_preview: string | null;
}

export class ConversationRepo implements IConversationRepo {
  create(title?: string): Conversation {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(id, title ?? null, now, now);
    this.set_current_id(id);
    return { id, title: title ?? null, created_at: now, updated_at: now };
  }

  find_by_id(id: string): Conversation | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(id) as ConversationRow | undefined;
    return row ? toEntity(row) : null;
  }

  list(limit = 50, offset = 0): ConversationSummary[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT
          c.id,
          c.title,
          c.created_at,
          c.updated_at,
          (
            SELECT COUNT(1)
            FROM messages m
            WHERE m.conversation_id = c.id
          ) AS message_count,
          (
            SELECT m.content
            FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT 1
          ) AS last_message_preview
        FROM conversations c
        ORDER BY c.updated_at DESC
        LIMIT ? OFFSET ?`,
      )
      .all(limit, offset) as ConversationSummaryRow[];
    return rows.map((row) => ({
      ...toEntity(row),
      message_count: row.message_count ?? 0,
      last_message_preview: row.last_message_preview,
    }));
  }

  get_current_id(): string | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('current_conversation_id') as { value: string | null } | undefined;
    const id = row?.value?.trim();
    return id ? id : null;
  }

  set_current_id(id: string | null): void {
    const db = getDatabase();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('current_conversation_id', id);
  }

  update_title(id: string, title: string): void {
    const db = getDatabase();
    db.prepare(
      "UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?",
    ).run(title, id);
  }

  delete(id: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    const current = this.get_current_id();
    if (current === id) {
      this.set_current_id(null);
    }
  }

  delete_all(): void {
    const db = getDatabase();
    db.prepare('DELETE FROM conversations').run();
    this.set_current_id(null);
  }
}

function toEntity(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
