import { getDatabase } from './database.js';

export interface ConversationContextRow {
  conversation_id: string;
  session_note: string;
  intent_json: string | null;
  updated_at: string;
}

/**
 * 会话级短生命周期备忘（与长期 record 分离）；compaction 时并入摘要后清空 session_note。
 */
export class ConversationContextRepo {
  get(conversation_id: string): ConversationContextRow | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT * FROM conversation_context WHERE conversation_id = ?')
      .get(conversation_id) as ConversationContextRow | undefined;
    return row ?? null;
  }

  /** 有非空 session_note 时返回，供进窗注入 */
  getSessionNote(conversation_id: string): string | null {
    const row = this.get(conversation_id);
    const n = row?.session_note?.trim();
    return n ? row!.session_note : null;
  }

  upsertSessionNote(conversation_id: string, note: string): void {
    const db = getDatabase();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO conversation_context (conversation_id, session_note, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         session_note = excluded.session_note,
         updated_at = excluded.updated_at`,
    ).run(conversation_id, note.trim(), now);
  }

  clearSessionNote(conversation_id: string): void {
    const db = getDatabase();
    db.prepare(
      `UPDATE conversation_context SET session_note = '', updated_at = ? WHERE conversation_id = ?`,
    ).run(new Date().toISOString(), conversation_id);
  }
}
