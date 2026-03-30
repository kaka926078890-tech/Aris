import { getDatabase } from './database.js';
import type { IRecordRepo } from '../types.js';
import { TimelineRepo } from './timelineRepo.js';

interface PreferenceRow {
  id: string;
  topic: string;
  summary: string;
  source: string | null;
  tags_json: string | null;
  created_at: string;
}

interface CorrectionRow {
  id: string;
  previous: string;
  correction: string;
  created_at: string;
}

export class RecordRepo implements IRecordRepo {
  private timelineRepo = new TimelineRepo();

  get_identity(): { name: string; notes: string } | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('identity_json') as { value: string | null } | undefined;
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value) as { name?: string; notes?: string };
      return {
        name: parsed.name ?? '',
        notes: parsed.notes ?? '',
      };
    } catch {
      return null;
    }
  }

  set_identity(payload: { name?: string; notes?: string }): void {
    const current = this.get_identity();
    const next = {
      name: payload.name ?? current?.name ?? '',
      notes: payload.notes ?? current?.notes ?? '',
    };
    const db = getDatabase();
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('identity_json', JSON.stringify(next));

    this.timelineRepo.add({
      id: crypto.randomUUID(),
      conversation_id: null,
      event_type: 'record_identity',
      role: null,
      message_id: null,
      content: `identity: name=${next.name || '未知'}; notes=${next.notes || '无'}`,
    });
  }

  add_preference(payload: {
    topic: string;
    summary: string;
    source?: string;
    tags?: string[];
  }): string {
    const db = getDatabase();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO preferences (id, topic, summary, source, tags_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      payload.topic,
      payload.summary,
      payload.source ?? null,
      payload.tags?.length ? JSON.stringify(payload.tags) : null,
      new Date().toISOString(),
    );

    this.timelineRepo.add({
      id: crypto.randomUUID(),
      conversation_id: null,
      event_type: 'record_preference',
      role: null,
      message_id: null,
      content: `preference: ${payload.topic} -> ${payload.summary}`,
    });
    return id;
  }

  list_preferences(topic?: string, limit = 20): Array<{
    id: string;
    topic: string;
    summary: string;
    source: string | null;
    tags: string[];
    created_at: string;
  }> {
    const db = getDatabase();
    const rows = (topic
      ? db
          .prepare(
            `SELECT * FROM preferences
             WHERE topic = ?
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(topic, limit)
      : db
          .prepare(
            `SELECT * FROM preferences
             ORDER BY created_at DESC
             LIMIT ?`,
          )
          .all(limit)) as PreferenceRow[];
    return rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      summary: r.summary,
      source: r.source,
      tags: r.tags_json ? (JSON.parse(r.tags_json) as string[]) : [],
      created_at: r.created_at,
    }));
  }

  add_correction(payload: { previous: string; correction: string }): string {
    const db = getDatabase();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO corrections (id, previous, correction, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      id,
      payload.previous,
      payload.correction,
      new Date().toISOString(),
    );

    this.timelineRepo.add({
      id: crypto.randomUUID(),
      conversation_id: null,
      event_type: 'record_correction',
      role: null,
      message_id: null,
      content: `correction: ${payload.previous} -> ${payload.correction}`,
    });
    return id;
  }

  list_corrections(limit = 20): Array<{
    id: string;
    previous: string;
    correction: string;
    created_at: string;
  }> {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM corrections
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(limit) as CorrectionRow[];
    return rows.map((r) => ({
      id: r.id,
      previous: r.previous,
      correction: r.correction,
      created_at: r.created_at,
    }));
  }
}
