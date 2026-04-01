import { getDatabase } from './database.js';
import type { IRecordRepo, PreferenceEntry, PreferenceMemoryKind } from '../types.js';
import { TimelineRepo } from './timelineRepo.js';

interface PreferenceRow {
  id: string;
  topic: string;
  summary: string;
  source: string | null;
  tags_json: string | null;
  created_at: string;
  memory_kind: string;
  description: string;
  why_context: string | null;
  how_to_apply: string | null;
  updated_at: string | null;
  expires_at: string | null;
  superseded_by_id: string | null;
}

interface CorrectionRow {
  id: string;
  previous: string;
  correction: string;
  created_at: string;
  why_context: string | null;
}

const INJECT_KINDS_SQL = `('preference', 'project_context')`;

function coerceKind(raw: string | null | undefined): PreferenceMemoryKind {
  const k = (raw || 'preference').toLowerCase();
  if (
    k === 'interaction_feedback' ||
    k === 'project_context' ||
    k === 'reference_pointer'
  ) {
    return k;
  }
  return 'preference';
}

function mapPreferenceRow(r: PreferenceRow): PreferenceEntry {
  return {
    id: r.id,
    topic: r.topic,
    summary: r.summary,
    source: r.source,
    tags: r.tags_json ? (JSON.parse(r.tags_json) as string[]) : [],
    created_at: r.created_at,
    memory_kind: coerceKind(r.memory_kind),
    description: r.description || r.topic,
    why_context: r.why_context,
    how_to_apply: r.how_to_apply,
    updated_at: r.updated_at,
    expires_at: r.expires_at,
  };
}

export class RecordRepo implements IRecordRepo {
  private timelineRepo = new TimelineRepo();

  get_identity(): { name: string; notes: string; updated_at?: string } | null {
    const db = getDatabase();
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('identity_json') as { value: string | null } | undefined;
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value) as {
        name?: string;
        notes?: string;
        updated_at?: string;
      };
      return {
        name: parsed.name ?? '',
        notes: parsed.notes ?? '',
        updated_at: parsed.updated_at,
      };
    } catch {
      return null;
    }
  }

  set_identity(payload: { name?: string; notes?: string }): void {
    const current = this.get_identity();
    const now = new Date().toISOString();
    const next = {
      name: payload.name ?? current?.name ?? '',
      notes: payload.notes ?? current?.notes ?? '',
      updated_at: now,
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

  get_ignored_topics(): string[] {
    const db = getDatabase();
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('user_ignored_topics_json') as { value: string | null } | undefined;
    if (!row?.value) return [];
    try {
      const parsed = JSON.parse(row.value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed.map((x) => String(x)).map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  }

  set_ignored_topics(topics: string[]): void {
    const db = getDatabase();
    const cleaned = topics.map((t) => String(t).trim()).filter(Boolean);
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('user_ignored_topics_json', JSON.stringify(cleaned));
    this.timelineRepo.add({
      id: crypto.randomUUID(),
      conversation_id: null,
      event_type: 'record_ignored_topics',
      role: null,
      message_id: null,
      content: `ignored_topics: ${cleaned.join(', ') || '（空）'}`,
    });
  }

  add_preference(payload: {
    topic: string;
    summary: string;
    source?: string;
    tags?: string[];
    memory_kind?: PreferenceMemoryKind;
    description?: string;
    why_context?: string;
    how_to_apply?: string;
    expires_at?: string | null;
  }): string {
    const db = getDatabase();
    const id = crypto.randomUUID();
    const iso = new Date().toISOString();
    const memoryKind = payload.memory_kind ?? 'preference';
    const description = (payload.description ?? payload.topic).trim() || payload.topic;

    db.transaction(() => {
      // supersede: same (topic, kind) latest active row
      const prev = db
        .prepare(
          `SELECT id FROM preferences
           WHERE topic = ?
             AND memory_kind = ?
             AND superseded_by_id IS NULL
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT 1`,
        )
        .get(payload.topic, memoryKind) as { id: string } | undefined;

      db.prepare(
        `INSERT INTO preferences (
          id, topic, summary, source, tags_json, created_at,
          memory_kind, description, why_context, how_to_apply, updated_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        payload.topic,
        payload.summary,
        payload.source ?? null,
        payload.tags?.length ? JSON.stringify(payload.tags) : null,
        iso,
        memoryKind,
        description,
        payload.why_context ?? null,
        payload.how_to_apply ?? null,
        iso,
        payload.expires_at ?? null,
      );

      if (prev?.id && prev.id !== id) {
        db.prepare(
          `UPDATE preferences
           SET superseded_by_id = ?, updated_at = ?
           WHERE id = ?`,
        ).run(id, iso, prev.id);
      }
    })();

    this.timelineRepo.add({
      id: crypto.randomUUID(),
      conversation_id: null,
      event_type: 'record_preference',
      role: null,
      message_id: null,
      content: `preference[${memoryKind}]: ${payload.topic} -> ${payload.summary}`,
    });
    return id;
  }

  list_preferences(topic?: string, limit = 20): PreferenceEntry[] {
    const db = getDatabase();
    const lim = Math.max(1, Math.min(200, limit));
    const rows = (topic
      ? db
          .prepare(
            `SELECT * FROM preferences
             WHERE topic = ?
             ORDER BY COALESCE(updated_at, created_at) DESC
             LIMIT ?`,
          )
          .all(topic, lim)
      : db
          .prepare(
            `SELECT * FROM preferences
             ORDER BY COALESCE(updated_at, created_at) DESC
             LIMIT ?`,
          )
          .all(lim)) as PreferenceRow[];
    return rows.map(mapPreferenceRow);
  }

  list_preferences_by_memory_kinds(kinds: string[], limit: number): PreferenceEntry[] {
    if (!kinds.length) return this.list_preferences(undefined, limit);
    const db = getDatabase();
    const lim = Math.max(1, Math.min(200, limit));
    const placeholders = kinds.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT * FROM preferences
         WHERE memory_kind IN (${placeholders})
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT ?`,
      )
      .all(...kinds, lim) as PreferenceRow[];
    return rows.map(mapPreferenceRow);
  }

  list_preferences_for_prompt(limit: number): PreferenceEntry[] {
    const db = getDatabase();
    const lim = Math.max(1, Math.min(50, limit));
    const rows = db
      .prepare(
        `SELECT * FROM preferences
         WHERE memory_kind IN ${INJECT_KINDS_SQL}
           AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
           AND superseded_by_id IS NULL
         ORDER BY COALESCE(updated_at, created_at) DESC
         LIMIT ?`,
      )
      .all(lim) as PreferenceRow[];
    return rows.map(mapPreferenceRow);
  }

  add_correction(payload: {
    previous: string;
    correction: string;
    why_context?: string;
  }): string {
    const db = getDatabase();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO corrections (id, previous, correction, created_at, why_context)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      id,
      payload.previous,
      payload.correction,
      new Date().toISOString(),
      payload.why_context ?? null,
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
    why_context: string | null;
  }> {
    const db = getDatabase();
    const rows = db
      .prepare(
        `SELECT * FROM corrections
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(Math.max(1, Math.min(200, limit))) as CorrectionRow[];
    return rows.map((r) => ({
      id: r.id,
      previous: r.previous,
      correction: r.correction,
      created_at: r.created_at,
      why_context: r.why_context,
    }));
  }
}
