import { getDatabase } from './database.js';

export interface ToolSummaryRow {
  id: string;
  conversation_id: string;
  message_id: string | null;
  round: number | null;
  tool_name: string;
  summary_text: string;
  created_at: string;
}

export class ToolSummaryRepo {
  add(payload: {
    conversation_id: string;
    message_id?: string | null;
    round?: number | null;
    tool_name: string;
    summary_text: string;
    created_at?: string;
  }): string {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const created_at = payload.created_at ?? new Date().toISOString();
    db.prepare(
      `INSERT INTO tool_summaries (id, conversation_id, message_id, round, tool_name, summary_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      payload.conversation_id,
      payload.message_id ?? null,
      payload.round ?? null,
      payload.tool_name,
      payload.summary_text,
      created_at,
    );
    return id;
  }

  list_recent(conversation_id: string, limit = 12): ToolSummaryRow[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM tool_summaries
         WHERE conversation_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(conversation_id, Math.max(1, Math.min(50, limit))) as ToolSummaryRow[];
    return rows;
  }
}

