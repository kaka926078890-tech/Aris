/**
 * v2 备份/恢复：SQLite + LanceDB，与 v1 格式兼容（.aris）。
 */
const fs = require('fs');
const path = require('path');

function getStore() {
  return require('../../packages/store');
}

function getConfig() {
  return require('../../packages/config');
}

async function exportToFile(filePath) {
  const store = getStore();
  const config = getConfig();
  const sqlitePath = config.getSqlitePath();
  let sqliteBase64 = '';
  if (fs.existsSync(sqlitePath)) {
    sqliteBase64 = fs.readFileSync(sqlitePath).toString('base64');
  }
  let memory = [];
  if (store.vector) {
    memory = await store.vector.exportAll();
  }
  const payload = { sqlite: sqliteBase64, memory, version: 1 };
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  console.info('[Aris v2][backup] export', filePath, 'memoryCount=', memory.length);
  return { memoryCount: memory.length };
}

async function importFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);
  const store = getStore();
  const config = getConfig();
  const targetDb = config.getSqlitePath();
  const dir = config.getDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  if (payload.sqlite) {
    store.db.closeWithoutPersist();
    fs.writeFileSync(targetDb, Buffer.from(payload.sqlite, 'base64'));
  }
  if (payload.memory && Array.isArray(payload.memory) && payload.memory.length > 0 && store.vector) {
    await store.vector.resetAndImport(payload.memory);
  }
  console.info('[Aris v2][backup] import', filePath);
}

module.exports = { exportToFile, importFromFile };
