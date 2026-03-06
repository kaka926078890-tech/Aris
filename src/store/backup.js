const fs = require('fs');
const path = require('path');
const { getUserDataPath } = require('./db.js');
const { exportAll, resetAndImport } = require('../memory/lancedb.js');

async function exportToFile(filePath) {
  const userDataPath = getUserDataPath();
  const sourceDb = path.join(userDataPath, 'aris.db');
  let sqliteBase64 = '';
  if (fs.existsSync(sourceDb)) {
    sqliteBase64 = fs.readFileSync(sourceDb).toString('base64');
  }
  const memory = await exportAll();
  console.info(`[Aris][backup] export: target=${filePath} sqliteBytes=${sqliteBase64 ? Buffer.from(sqliteBase64, 'base64').length : 0} memoryCount=${memory.length}`);
  const payload = { sqlite: sqliteBase64, memory, version: 1 };
  fs.writeFileSync(filePath, JSON.stringify(payload), 'utf8');
  return { memoryCount: memory.length };
}

async function importFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const payload = JSON.parse(raw);
  console.info(`[Aris][backup] import: source=${filePath} hasSqlite=${!!payload.sqlite} memoryCount=${Array.isArray(payload.memory) ? payload.memory.length : 0}`);
  const userDataPath = getUserDataPath();
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  const targetDb = path.join(userDataPath, 'aris.db');
  if (payload.sqlite) {
    const { closeWithoutPersist } = require('./db.js');
    closeWithoutPersist();
    fs.writeFileSync(targetDb, Buffer.from(payload.sqlite, 'base64'));
  }
  if (payload.memory && Array.isArray(payload.memory) && payload.memory.length > 0) {
    console.info('[Aris][backup] import: resetting LanceDB and importing memory…');
    await resetAndImport(payload.memory);
    console.info('[Aris][backup] import: LanceDB import done');
  }
}

module.exports = { exportToFile, importFromFile };
