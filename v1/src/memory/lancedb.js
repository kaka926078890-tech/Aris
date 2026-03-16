/**
 * LanceDB for vector memory. ESM package used via dynamic import.
 * Table: memory (id, text, vector, type, created_at, metadata)
 * Types: user_preference | user_view | correction | aris_thought | aris_emotion | aris_behavior | aris_expression_desire | aris_file_operation
 */
const path = require('path');

let db = null;
let table = null;
const TABLE_NAME = 'memory';

function getUserDataPath() {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'aris');
  } catch (_) {
    return path.join(process.cwd(), 'data', 'aris');
  }
}

async function getLance() {
  if (db) return db;
  const lancedb = await import('@lancedb/lancedb');
  const userDataPath = process.env.ARIS_DATA_DIR || getUserDataPath();
  const dbPath = path.join(userDataPath, 'lancedb');
  const fs = require('fs');
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  db = await lancedb.connect(dbPath);
  try {
    table = await db.openTable(TABLE_NAME);
  } catch (_) {
    table = null;
  }
  return db;
}

async function getTable(vectorDimension) {
  await getLance();
  if (table) return table;
  table = await db.createTable(TABLE_NAME, [
    {
      id: 0,
      text: '',
      vector: Array(vectorDimension).fill(0),
      type: 'user_preference',
      created_at: Date.now(),
      metadata: {},
    },
  ]);
  const all = await table.query().limit(1).toArray();
  if (all.length) await table.delete('id = 0');
  return table;
}

async function addMemory({ text, vector, type, metadata }) {
  if (!vector || !Array.isArray(vector) || vector.length === 0) return;
  const tbl = await getTable(vector.length);
  const row = {
    id: Date.now() + Math.random(),
    text: String(text || ''),
    vector,
    type: String(type || 'user_preference'),
    created_at: Date.now(),
    metadata: metadata || {},
  };
  try {
    await tbl.add([row]);
  } catch (e) {
    if (row.metadata && Object.keys(row.metadata).length > 0) {
      delete row.metadata;
      await tbl.add([row]);
      console.info(`[Aris][memory] add (no metadata): type=${row.type} textLen=${row.text.length} dim=${vector.length}`);
      return;
    }
    throw e;
  }
  console.info(`[Aris][memory] add: type=${row.type} textLen=${row.text.length} dim=${vector.length} metadata=${JSON.stringify(row.metadata)}`);
}

/**
 * 按 id 删除一条记忆（用于表达后移除已使用的表达欲望，避免重复）
 */
async function deleteMemoryById(id) {
  if (id == null || id === '') return;
  await getLance();
  if (!table) return;
  try {
    await table.delete(`id = ${id}`);
    console.info(`[Aris][memory] delete: id=${id}`);
  } catch (e) {
    console.warn('[Aris][memory] deleteMemoryById failed:', e && e.message ? e.message : e);
  }
}

async function search(queryVector, limit = 10) {
  if (!queryVector || !Array.isArray(queryVector) || queryVector.length === 0) return [];
  await getTable(queryVector.length);
  const results = await table.vectorSearch(queryVector).limit(limit).toArray();
  return results;
}

async function listAllMeta(limit = 5000) {
  await getLance();
  if (!table) return [];
  const rows = await table.query().limit(limit).toArray();
  return rows.map((r) => ({
    id: r.id,
    text: r.text,
    type: r.type,
    created_at: r.created_at,
    metadata: r.metadata || {},
  })).filter((r) => r.text != null && String(r.text).trim() !== '');
}

/**
 * 按类型取最近 N 条（按 created_at 倒序），用于「用户身份/要求」等需常注入的记忆。
 */
async function getRecentByTypes(types, limit = 10) {
  if (!Array.isArray(types) || types.length === 0) return [];
  const set = new Set(types.map((t) => String(t)));
  const rows = await listAllMeta(3000);
  return rows
    .filter((r) => set.has(String(r.type || '')))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit);
}

async function getStats(sampleLimit = 100000) {
  await getLance();
  if (!table) {
    return {
      hasTable: false,
      path: getLanceDbPath(),
      total: 0,
      byType: {},
      createdAtMin: null,
      createdAtMax: null,
    };
  }
  const rows = await table.query().limit(sampleLimit).toArray();
  const byType = {};
  let createdAtMin = null;
  let createdAtMax = null;
  for (const r of rows) {
    const t = String(r.type || 'unknown');
    byType[t] = (byType[t] || 0) + 1;
    const ts = typeof r.created_at === 'number' ? r.created_at : null;
    if (ts != null) {
      createdAtMin = createdAtMin == null ? ts : Math.min(createdAtMin, ts);
      createdAtMax = createdAtMax == null ? ts : Math.max(createdAtMax, ts);
    }
  }
  return {
    hasTable: true,
    path: getLanceDbPath(),
    total: rows.length,
    byType,
    createdAtMin,
    createdAtMax,
    sampled: rows.length,
    sampleLimit,
  };
}

async function exportAll() {
  await getLance();
  if (!table) return [];
  const rows = await table.query().limit(100000).toArray();
  return rows.map((r) => ({
    text: r.text,
    vector: Array.isArray(r.vector) ? r.vector : (r.vector && r.vector.length != null ? Array.from(r.vector) : []),
    type: r.type,
    created_at: r.created_at,
    metadata: r.metadata || {},
  })).filter((r) => r.vector && r.vector.length > 0);
}

async function resetLanceDb() {
  const fs = require('fs');
  if (table) {
    try { table.close(); } catch (_) {}
    table = null;
  }
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
  const lancePath = getLanceDbPath();
  if (fs.existsSync(lancePath)) {
    fs.rmSync(lancePath, { recursive: true });
  }
}

async function resetAndImport(records) {
  if (!records || !Array.isArray(records) || records.length === 0) return;
  const fs = require('fs');
  if (table) {
    try { table.close(); } catch (_) {}
    table = null;
  }
  if (db) {
    try { db.close(); } catch (_) {}
    db = null;
  }
  const lancePath = getLanceDbPath();
  if (fs.existsSync(lancePath)) {
    fs.rmSync(lancePath, { recursive: true });
  }
  for (const r of records) {
    if (!r.vector || !Array.isArray(r.vector) || r.vector.length === 0) continue;
    await addMemory({
      text: r.text,
      vector: r.vector,
      type: r.type,
      metadata: r.metadata || {},
    });
  }
}

function getLanceDbPath() {
  const userDataPath = process.env.ARIS_DATA_DIR || getUserDataPath();
  return path.join(userDataPath, 'lancedb');
}

module.exports = { addMemory, search, listAllMeta, getRecentByTypes, getStats, getTable, getLance, exportAll, resetLanceDb, resetAndImport, getLanceDbPath, deleteMemoryById };