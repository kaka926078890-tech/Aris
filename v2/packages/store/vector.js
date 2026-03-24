/**
 * 向量库封装：LanceDB + embedding。与 v1 一致，路径为 v2 独立路径。
 * 检索最终方案（默认）：向量 ANN + MiniSearch(BM25 风格全文) 混合召回 → Top-K 池内余弦重排 → 时间衰减。
 * 关闭混合：ARIS_MEMORY_HYBRID=false 时回退为纯向量 + 时间衰减。
 */
const fs = require('fs');
const MiniSearch = require('minisearch');
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

/** MiniSearch 索引缓存；add / reset 时失效 */
let hybridIndexCache = null;

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

function invalidateHybridIndexCache() {
  hybridIndexCache = null;
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
  invalidateHybridIndexCache();
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

function toVectorArray(v) {
  if (Array.isArray(v) && v.length > 0) return v;
  if (v && typeof v.length === 'number') return Array.from(v);
  return [];
}

/** 中文友好：字 + 二字片段，兼顾 BM25 词项 */
function tokenizeMemoryText(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c.trim().length || /[\u4e00-\u9fff]/.test(c)) out.push(c);
  }
  for (let i = 0; i < s.length - 1; i++) {
    out.push(s.slice(i, i + 2));
  }
  return out.length ? out : [''];
}

function minMaxNormalize(values) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-12) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

function cosineSimilarity(a, b) {
  const va = toVectorArray(a);
  const vb = toVectorArray(b);
  if (!va.length || va.length !== vb.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < va.length; i++) {
    dot += va[i] * vb[i];
    na += va[i] * va[i];
    nb += vb[i] * vb[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d < 1e-12 ? 0 : dot / d;
}

function parseFloatEnv(name, def) {
  const v = process.env[name];
  if (v == null || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function isHybridEnabled() {
  const v = process.env.ARIS_MEMORY_HYBRID;
  if (v === 'false' || v === '0') return false;
  return true;
}

async function loadAllRowsRaw() {
  await getLance();
  if (!table) return [];
  const rows = await table.query().limit(100000).toArray();
  return rows.filter((r) => toVectorArray(r.vector).length > 0);
}

async function getHybridIndex() {
  if (hybridIndexCache) return hybridIndexCache;
  const rows = await loadAllRowsRaw();
  const ms = new MiniSearch({
    fields: ['text'],
    storeFields: ['id'],
    tokenize: (text) => tokenizeMemoryText(text),
    searchOptions: {
      boost: { text: 1 },
      fuzzy: 0,
    },
  });
  ms.addAll(
    rows.map((r) => ({
      id: String(r.id),
      text: String(r.text || ''),
    })),
  );
  const idToRow = new Map(rows.map((r) => [String(r.id), r]));
  hybridIndexCache = { miniSearch: ms, idToRow };
  return hybridIndexCache;
}

/**
 * 纯向量 + 时间衰减（旧行为）
 */
async function searchVectorOnly(queryText, limit, options) {
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

/**
 * 混合召回 + 余弦重排 + 时间衰减
 */
async function searchHybridRerank(queryText, limit, options) {
  const filterByEntities = options.filterByEntities;
  const vecFetch = Math.floor(parseFloatEnv('ARIS_HYBRID_VECTOR_FETCH', 120));
  const bm25Fetch = Math.floor(parseFloatEnv('ARIS_HYBRID_BM25_FETCH', 120));
  const rerankPool = Math.floor(parseFloatEnv('ARIS_RERANK_POOL_SIZE', 40));
  const wVec = parseFloatEnv('ARIS_HYBRID_VECTOR_WEIGHT', 0.4);
  const wBm25 = parseFloatEnv('ARIS_HYBRID_BM25_WEIGHT', 0.4);
  const wHybrid = parseFloatEnv('ARIS_RERANK_HYBRID_WEIGHT', 0.45);
  const wCos = parseFloatEnv('ARIS_RERANK_COSINE_WEIGHT', 0.55);

  const queryVector = await embed(queryText, { prefix: 'query' });
  if (!queryVector) return [];

  const { miniSearch, idToRow } = await getHybridIndex();

  let vecRaw = await _rawSearch(queryVector, vecFetch);
  if (filterByEntities && filterByEntities.length > 0) {
    vecRaw = vecRaw.filter((r) => rowMatchesEntities(r, filterByEntities));
  }

  let bm25Hits = [];
  try {
    bm25Hits = miniSearch.search(String(queryText || '').trim(), { limit: bm25Fetch });
  } catch (e) {
    console.warn('[Aris v2][store/vector] MiniSearch failed', e?.message);
  }

  const unionIds = new Set();
  const vecById = new Map();
  for (const r of vecRaw) {
    const id = String(r.id);
    unionIds.add(id);
    const dist = r._distance != null ? r._distance : (r.distance != null ? r.distance : 0);
    vecById.set(id, 1 / (1 + dist));
  }
  const bm25ById = new Map();
  for (const h of bm25Hits) {
    const id = String(h.id);
    unionIds.add(id);
    bm25ById.set(id, Number(h.score) || 0);
  }

  if (unionIds.size === 0) return [];

  const ids = [...unionIds];
  const vecSims = ids.map((id) => vecById.get(id) ?? 0);
  const bm25Scores = ids.map((id) => bm25ById.get(id) ?? 0);
  const nVec = minMaxNormalize(vecSims);
  const nBm25 = minMaxNormalize(bm25Scores);
  const wSum = wVec + wBm25;
  const nv = wSum > 1e-9 ? wVec / wSum : 0.5;
  const nb = wSum > 1e-9 ? wBm25 / wSum : 0.5;

  const hybridStage = ids.map((id, i) => {
    const row = idToRow.get(id);
    if (!row) return null;
    if (filterByEntities && filterByEntities.length > 0 && !rowMatchesEntities(row, filterByEntities)) {
      return null;
    }
    const hybridSim = nv * nVec[i] + nb * nBm25[i];
    return { row, hybridSim };
  }).filter(Boolean);

  hybridStage.sort((a, b) => b.hybridSim - a.hybridSim);
  const pool = hybridStage.slice(0, Math.max(rerankPool, limit * 3));

  const cosScores = pool.map(({ row }) => cosineSimilarity(queryVector, row.vector));
  const nHybrid = minMaxNormalize(pool.map((p) => p.hybridSim));
  const nCos = minMaxNormalize(cosScores);
  const hSum = wHybrid + wCos;
  const wh = hSum > 1e-9 ? wHybrid / hSum : 0.5;
  const wc = hSum > 1e-9 ? wCos / hSum : 0.5;

  const reranked = pool.map((p, i) => {
    const combined = wh * nHybrid[i] + wc * nCos[i];
    const decay = timeDecayFactor(p.row.created_at);
    const score = VECTOR_SIMILARITY_WEIGHT * combined + VECTOR_TIME_WEIGHT * decay;
    return { ...p.row, _score: score };
  });
  reranked.sort((a, b) => (b._score || 0) - (a._score || 0));
  return reranked.slice(0, limit);
}

/**
 * 检索：默认混合 + 重排；ARIS_MEMORY_HYBRID=false 时为纯向量。
 * @param {string} queryText
 * @param {number} limit
 * @param {{ filterByEntities?: { type: string, id: string }[] }} options - 分层记忆：只保留与这些实体相关的经历
 */
async function search(queryText, limit = 10, options = {}) {
  if (!isHybridEnabled()) {
    return searchVectorOnly(queryText, limit, options);
  }
  return searchHybridRerank(queryText, limit, options);
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
  invalidateHybridIndexCache();
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
