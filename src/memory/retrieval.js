const { embed } = require('./embedding.js');
const { search } = require('./lancedb.js');

function getText(row) {
  if (row == null) return '';
  const t = row.text ?? row.Text ?? (typeof row.get === 'function' ? row.get('text') : undefined);
  return typeof t === 'string' ? t : String(t ?? '');
}

/**
 * Semantic retrieval: embed query, search LanceDB, return top-k (user + Aris side).
 */
async function retrieve(queryText, limit = 10) {
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
  if (rows.length > 0 && rows[0] != null) {
    const keys = Object.keys(rows[0]);
    if (keys.length > 0) console.info('[Aris][memory] search row keys:', keys.join(', '));
  }
  const out = rows
    .map((r) => ({ ...r, text: getText(r) }))
    .filter((r) => r.text != null && String(r.text).trim() !== '');
  return out;
}

module.exports = { retrieve };
