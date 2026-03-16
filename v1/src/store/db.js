const path = require('path');
const fs = require('fs');

function getUserDataPath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'aris');
  } catch (_) {
    return path.join(process.cwd(), 'data', 'aris');
  }
}

const dbPath = path.join(getUserDataPath(), 'aris.db');
let db = null;

let SQL = null;

async function getDb() {
  if (db) return db;
  if (!SQL) {
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs();
  }
  const userDataPath = getUserDataPath();
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  let data = null;
  if (fs.existsSync(dbPath)) {
    data = new Uint8Array(fs.readFileSync(dbPath));
  }
  db = new SQL.Database(data);
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
    );
    CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(session_id);
    CREATE INDEX IF NOT EXISTS idx_conv_created ON conversations(created_at);
  `);
  return db;
}

function persist() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }
}

function close() {
  if (db) {
    persist();
    db.close();
    db = null;
  }
}

function closeWithoutPersist() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, close, closeWithoutPersist, persist, dbPath, getUserDataPath };
