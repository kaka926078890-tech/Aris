const { embed } = require('./embedding.js');
const { search, getRecentByTypes } = require('./lancedb.js');

function getText(row) {
  if (row == null) return '';
  const t = row.text ?? row.Text ?? (typeof row.get === 'function' ? row.get('text') : undefined);
  return typeof t === 'string' ? t : String(t ?? '');
}

function getMetadata(row) {
  if (row == null) return {};
  const m = row.metadata ?? row.Metadata ?? (typeof row.get === 'function' ? row.get('metadata') : undefined);
  return typeof m === 'object' && m !== null ? m : {};
}

/**
 * Semantic retrieval: embed query, search LanceDB, return top-k (user + Aris side).
 */
async function retrieve(queryText, limit = 5) {
  const vector = await embed(queryText);
  if (!vector) {
    console.info('[Aris][memory] embed(query) failed; retrieval skipped');
    return [];
  }
  let rows = [];
  try {
    rows = await search(vector, limit);
  } catch (e) {
    console.warn('[Aris][memory] search failed:', e && e.message ? e.message : e);
    return [];
  }
  const out = rows
    .map((r) => ({ 
      ...r, 
      text: getText(r),
      metadata: getMetadata(r)
    }))
    .filter((r) => r.text != null && String(r.text).trim() !== '');

  if (out.length > 0) {
    const queryPreview = (queryText || '').slice(0, 60);
    console.info(`[Aris][memory] 召回 ${out.length} 条 (query: \"${queryPreview}${(queryText || '').length > 60 ? '…' : ''}\")`);
    out.forEach((r, i) => {
      const type = r.type != null ? r.type : 'unknown';
      const snippet = String(r.text || '').slice(0, 80).replace(/\n/g, ' ');
      console.info(`[Aris][memory]   ${i + 1}. [${type}] ${snippet}${(r.text || '').length > 80 ? '…' : ''}`);
    });
  } else {
    console.info('[Aris][memory] 召回 0 条');
  }

  return out;
}

/**
 * 按类型检索记忆，不依赖语义相似度
 */
async function retrieveByTypes(types, limit = 10) {
  if (!Array.isArray(types) || types.length === 0) return [];
  
  try {
    // 使用 getRecentByTypes 获取完整的记忆记录（包括 metadata）
    const memories = await getRecentByTypes(types, limit);
    return memories;
  } catch (e) {
    console.warn('[Aris][memory] retrieveByTypes failed:', e && e.message ? e.message : e);
    return [];
  }
}

module.exports = { retrieve, retrieveByTypes };