import { getDatabase } from './database.js';

export interface ConversationCompactionRow {
  conversation_id: string;
  summary_text: string;
  first_kept_message_id: string;
  updated_at: string;
}

export class CompactionRepo {
  get(conversation_id: string): ConversationCompactionRow | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM conversation_compaction WHERE conversation_id = ?')
      .get(conversation_id) as ConversationCompactionRow | undefined;
    return row ?? null;
  }

  upsert(payload: {
    conversation_id: string;
    summary_text: string;
    first_kept_message_id: string;
  }): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO conversation_compaction (conversation_id, summary_text, first_kept_message_id, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         summary_text = excluded.summary_text,
         first_kept_message_id = excluded.first_kept_message_id,
         updated_at = excluded.updated_at`,
    ).run(
      payload.conversation_id,
      payload.summary_text,
      payload.first_kept_message_id,
      now,
    );
  }

  delete(conversation_id: string): void {
    const db = getDatabase();
    db.prepare('DELETE FROM conversation_compaction WHERE conversation_id = ?').run(
      conversation_id,
    );
  }
}
