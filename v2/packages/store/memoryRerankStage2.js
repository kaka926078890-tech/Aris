/**
 * 记忆检索第二阶段：RRF（倒数排名融合）+ 查询字面覆盖。
 * 不依赖额外 ML 运行时。
 */

function assignRanks(scores, higherIsBetter = true) {
  const n = scores.length;
  if (n === 0) return [];
  const idx = [...Array(n).keys()];
  idx.sort((a, b) => (higherIsBetter ? scores[b] - scores[a] : scores[a] - scores[b]));
  const ranks = new Array(n);
  idx.forEach((orig, pos) => {
    ranks[orig] = pos + 1;
  });
  return ranks;
}

function rrfFromRanks(rankArrays, k) {
  const n = rankArrays[0]?.length ?? 0;
  if (n === 0) return [];
  const out = new Array(n).fill(0);
  for (const ranks of rankArrays) {
    for (let i = 0; i < n; i++) {
      out[i] += 1 / (k + ranks[i]);
    }
  }
  return out;
}

/** 查询字符在文档中的覆盖率（中文友好），[0,1] */
function lexicalCoverage(query, text) {
  const q = String(query || '').replace(/\s+/g, '');
  const t = String(text || '');
  if (!q.length) return 0;
  let hit = 0;
  for (let i = 0; i < q.length; i++) {
    if (t.includes(q[i])) hit += 1;
  }
  let bigramHit = 0;
  const bigramTotal = Math.max(0, q.length - 1);
  for (let i = 0; i < q.length - 1; i++) {
    if (t.includes(q.slice(i, i + 2))) bigramHit += 1;
  }
  const uni = hit / q.length;
  const bi = bigramTotal > 0 ? bigramHit / bigramTotal : 0;
  return Math.min(1, 0.45 * uni + 0.55 * bi);
}

function minMaxNormalize(values) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-12) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

/**
 * @param {string} queryText
 * @param {{ row: object, hybridSim: number }[]} pool
 * @param {Map<string, number>} vecById
 * @param {Map<string, number>} bm25ById
 * @param {number[]} cosScores 与 pool 等长
 * @param {{ kRrf?: number }} opts
 * @returns {{ rrf: number[], lexical: number[], vecArr: number[], bmArr: number[] }}
 */
function computeRrfAndLexical(queryText, pool, vecById, bm25ById, cosScores, opts = {}) {
  const kRrf = opts.kRrf != null ? opts.kRrf : 60;
  const n = pool.length;
  if (n === 0) {
    return { rrf: [], lexical: [], vecArr: [], bmArr: [] };
  }
  const vecArr = pool.map(({ row }) => vecById.get(String(row.id)) ?? 0);
  const bmArr = pool.map(({ row }) => bm25ById.get(String(row.id)) ?? 0);
  const rv = assignRanks(vecArr);
  const rb = assignRanks(bmArr);
  const rc = assignRanks(cosScores);
  const rrf = rrfFromRanks([rv, rb, rc], kRrf);
  const lexical = pool.map(({ row }) => lexicalCoverage(queryText, row.text || ''));
  return { rrf, lexical, vecArr, bmArr };
}

module.exports = {
  computeRrfAndLexical,
  lexicalCoverage,
  minMaxNormalize,
};
