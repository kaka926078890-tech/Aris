import { getDatabase } from './database.js';

export type TimelineEvent = {
  id: string;
  conversation_id: string | null;
  event_type: string;
  role: string | null;
  message_id: string | null;
  content: string;
  created_at: string;
};

type EventRow = TimelineEvent;

export class TimelineRepo {
  add(event: Omit<TimelineEvent, 'created_at'> & { created_at?: string }): string {
    const db = getDatabase();
    const id = event.id || crypto.randomUUID();
    const created_at = event.created_at ?? new Date().toISOString();
    db.prepare(
      `INSERT INTO events (id, conversation_id, event_type, role, message_id, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      event.conversation_id ?? null,
      event.event_type,
      event.role ?? null,
      event.message_id ?? null,
      event.content,
      created_at,
    );
    return id;
  }

  list_recent(conversation_id: string | null, limit = 30): TimelineEvent[] {
    const db = getDatabase();
    const rows = (conversation_id
      ? db
          .prepare(
            `SELECT * FROM events
             WHERE conversation_id = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(conversation_id, limit)
      : db
          .prepare(
            `SELECT * FROM events
             WHERE conversation_id IS NULL
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(limit)) as EventRow[];
    return rows.map((r) => ({
      id: r.id,
      conversation_id: r.conversation_id ?? null,
      event_type: r.event_type,
      role: r.role ?? null,
      message_id: r.message_id ?? null,
      content: r.content,
      created_at: r.created_at,
    }));
  }
}

