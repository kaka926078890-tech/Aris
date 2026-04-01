import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { config } from '../config.js';
import { logger } from '../logger.js';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  fs.mkdirSync(config.data_dir, { recursive: true });
  const dbPath = path.join(config.data_dir, 'aris.db');
  logger.info({ dbPath }, 'Opening SQLite database');

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ── Migrations ──

interface Migration {
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    name: '001_init',
    sql: `
      CREATE TABLE conversations (
        id          TEXT PRIMARY KEY,
        title       TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE messages (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role            TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
        content         TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        token_count     INTEGER,
        metadata_json   TEXT,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_messages_conv ON messages(conversation_id, created_at);

      CREATE TABLE embeddings (
        id          TEXT PRIMARY KEY,
        message_id  TEXT NOT NULL,
        model       TEXT NOT NULL,
        dimension   INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );

      CREATE INDEX idx_embeddings_msg ON embeddings(message_id);
    `,
  },
  {
    name: '002_settings_table',
    sql: `
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );
    `,
  },
  {
    name: '003_embedding_source_fields',
    sql: `
      ALTER TABLE embeddings ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'message';
      ALTER TABLE embeddings ADD COLUMN source_text TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    name: '004_chat_records',
    sql: `
      CREATE TABLE IF NOT EXISTS preferences (
        id          TEXT PRIMARY KEY,
        topic       TEXT NOT NULL,
        summary     TEXT NOT NULL,
        source      TEXT,
        tags_json   TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_preferences_topic_created
      ON preferences(topic, created_at DESC);

      CREATE TABLE IF NOT EXISTS corrections (
        id          TEXT PRIMARY KEY,
        previous    TEXT NOT NULL,
        correction  TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    name: '005_events_timeline',
    sql: `
      CREATE TABLE IF NOT EXISTS events (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT,
        event_type      TEXT NOT NULL,
        role            TEXT,
        message_id      TEXT,
        content         TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_conv_created
      ON events(conversation_id, created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_events_type_created
      ON events(event_type, created_at DESC);
    `,
  },
  {
    name: '006_conversation_compaction',
    sql: `
      CREATE TABLE IF NOT EXISTS conversation_compaction (
        conversation_id       TEXT PRIMARY KEY,
        summary_text          TEXT NOT NULL,
        first_kept_message_id TEXT NOT NULL,
        updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (first_kept_message_id) REFERENCES messages(id)
      );
    `,
  },
  {
    name: '007_memory_kinds_session_context',
    sql: `
      ALTER TABLE preferences ADD COLUMN memory_kind TEXT NOT NULL DEFAULT 'preference';
      ALTER TABLE preferences ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE preferences ADD COLUMN why_context TEXT;
      ALTER TABLE preferences ADD COLUMN how_to_apply TEXT;
      ALTER TABLE preferences ADD COLUMN updated_at TEXT;
      ALTER TABLE preferences ADD COLUMN expires_at TEXT;
      ALTER TABLE preferences ADD COLUMN superseded_by_id TEXT;

      UPDATE preferences SET description = topic
        WHERE description IS NULL OR trim(description) = '';
      UPDATE preferences SET updated_at = created_at
        WHERE updated_at IS NULL;

      ALTER TABLE corrections ADD COLUMN why_context TEXT;

      CREATE TABLE IF NOT EXISTS conversation_context (
        conversation_id TEXT PRIMARY KEY,
        session_note    TEXT NOT NULL DEFAULT '',
        intent_json     TEXT,
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_preferences_kind_updated
      ON preferences (memory_kind, updated_at DESC);
    `,
  },
  {
    name: '008_tool_summaries_and_ignored_topics',
    sql: `
      CREATE TABLE IF NOT EXISTS tool_summaries (
        id              TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        message_id      TEXT,
        round           INTEGER,
        tool_name       TEXT NOT NULL,
        summary_text    TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tool_summaries_conv_created
      ON tool_summaries (conversation_id, created_at DESC);

      INSERT OR IGNORE INTO settings (key, value) VALUES ('user_ignored_topics_json', '[]');
    `,
  },
];

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(
      (r) => r.name,
    ),
  );

  for (const m of migrations) {
    if (applied.has(m.name)) continue;
    logger.info({ migration: m.name }, 'Applying migration');
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(m.name);
    })();
  }
}
