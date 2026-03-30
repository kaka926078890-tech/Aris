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
