/**
 * 向量库封装：LanceDB + embedding。与 v1 一致，路径为 v2 独立路径。
 * 5 项优化：search_document/search_query 前缀、时间衰减、拼接块由 handler 负责。
 */
const fs = require('fs');
const {
  getDataDir,
  getLanceDbPath,
} = require('../config/paths.js');
const {
  SEARCH_DOCUMENT_PREFIX,
  SEARCH_QUERY_PREFIX,
  VECTOR_SIMILARITY_WEIGHT,
  VECTOR_TIME_WEIGHT,
} = require('../config/constants.js');

const OLLAMA_EMBED_URL = (process.env.OLLAMA_HOST || 'http://127.0.0.1:11434').replace('localhost', '127.0.0.1');
const EMBED_MODEL = process.env.ARIS_EMBED_MODEL || 'nomic-embed-text';

let db = null;
let table = null;
const TABLE_NAME = 'memory';

function normalizeEmbeddingResponse(data) {
  if (!data) return null;
  const emb =
    data.embedding ??
    (Array.isArray(data.embeddings) ? data.embeddings[0] : null) ??
    (Array.isArray(data.data) ? data.data?.[0]?.embedding : null);
  return Array.isArray(emb) && emb.length > 0 ? emb : null;
}

/**
 * @param {string} text
 * @param {{ prefix?: 'document' | 'query' }} options - document: 存时用；query: 检索时用
 */
async function embed(text, options = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let input = text.trim();
  if (options.prefix === 'document') input = SEARCH_DOCUMENT_PREFIX + input;
  else if (options.prefix === 'query') input = SEARCH_QUERY_PREFIX + input;
  try {
    const attempts = [
      { url: `${OLLAMA_EMBED_URL}/api/embeddings`, body: { model: EMBED_MODEL, prompt: input } },
      { url: `${OLLAMA_EMBED_URL}/api/embeddings`, body: { model: EMBED_MODEL, input } },
    ];
    let lastErr = null;
    for (const a of attempts) {
      try {
        const res = await fetch(a.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(a.body),
        });
        if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
        const data = await res.json();
        const vec = normalizeEmbeddingResponse(data);
        if (vec) return vec;
        lastErr = new Error('Empty embedding');
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error('Empty embedding');
  } catch (e) {
    console.warn('[Aris v2][store/vector] embed failed', e?.message);
    return null;
  }
}

async function getLance() {
  if (db) return db;
  const lancedb = await import('@lancedb/lancedb');
  const userDataPath = getDataDir();
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = getLanceDbPath();
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

async function add({ text, vector, type, metadata }) {
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
    } else throw e;
  }
  console.info('[Aris v2][store/vector] add type=%s', row.type);
}

async function _rawSearch(queryVector, limit = 20) {
  if (!queryVector || !Array.isArray(queryVector) || queryVector.length === 0) return [];
  await getTable(queryVector.length);
  return await table.vectorSearch(queryVector).limit(limit).toArray();
}

/** 时间衰减因子：越近越大，约 30 天内接近 1 */
function timeDecayFactor(createdAt) {
  const ts = typeof createdAt === 'number' ? createdAt : (createdAt ? new Date(createdAt).getTime() : Date.now());
  const daysSince = (Date.now() - ts) / (24 * 60 * 60 * 1000);
  return Math.max(0, 1 - daysSince / 365);
}

/** 判断一条记录的 metadata.related_entities 是否与给定实体列表有交集 */
function rowMatchesEntities(row, filterByEntities) {
  if (!filterByEntities || filterByEntities.length === 0) return true;
  const meta = row.metadata || {};
  const rel = meta.related_entities;
  if (!Array.isArray(rel) || rel.length === 0) return false;
  for (const f of filterByEntities) {
    for (const r of rel) {
      if (r && String(r.type) === String(f.type) && String(r.id) === String(f.id)) return true;
    }
  }
  return false;
}

/**
 * 检索：query 加 search_query 前缀后 embed，再向量搜索，最后用时间衰减融合得分并重排。
 * @param {string} queryText
 * @param {number} limit
 * @param {{ filterByEntities?: { type: string, id: string }[] }} options - 分层记忆：只保留与这些实体相关的经历
 */
async function search(queryText, limit = 10, options = {}) {
  const queryVector = await embed(queryText, { prefix: 'query' });
  if (!queryVector) return [];
  const filterByEntities = options.filterByEntities;
  const fetchLimit = filterByEntities && filterByEntities.length > 0 ? Math.max(limit * 4, 50) : Math.max(limit * 2, 20);
  let raw = await _rawSearch(queryVector, fetchLimit);
  if (filterByEntities && filterByEntities.length > 0) {
    raw = raw.filter((r) => rowMatchesEntities(r, filterByEntities));
  }
  if (!raw.length) return [];
  const withScore = raw.map((r) => {
    const dist = r._distance != null ? r._distance : (r.distance != null ? r.distance : 0);
    const sim = 1 / (1 + dist);
    const decay = timeDecayFactor(r.created_at);
    const score = VECTOR_SIMILARITY_WEIGHT * sim + VECTOR_TIME_WEIGHT * decay;
    return { ...r, _score: score };
  });
  withScore.sort((a, b) => (b._score || 0) - (a._score || 0));
  return withScore.slice(0, limit);
}

async function getRecentByType(type, limit = 10) {
  await getLance();
  if (!table) return [];
  const rows = await table.query().limit(5000).toArray();
  return rows
    .filter((r) => String(r.type || '') === String(type))
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, limit);
}

function toVectorArray(v) {
  if (Array.isArray(v) && v.length > 0) return v;
  if (v && typeof v.length === 'number') return Array.from(v);
  return [];
}

async function exportAll() {
  await getLance();
  if (!table) return [];
  const rows = await table.query().limit(100000).toArray();
  return rows.map((r) => {
    const vector = toVectorArray(r.vector);
    return {
      text: r.text,
      vector,
      type: r.type,
      created_at: r.created_at,
      metadata: r.metadata || {},
    };
  }).filter((r) => r.vector && r.vector.length > 0);
}

async function resetAndImport(records) {
  if (!records || !Array.isArray(records) || records.length === 0) return;
  table = null;
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
    await add({
      text: r.text,
      vector: r.vector,
      type: r.type,
      metadata: r.metadata || {},
    });
  }
}

module.exports = {
  embed,
  add,
  search,
  getRecentByType,
  exportAll,
  resetAndImport,
  getLanceDbPath,
};
