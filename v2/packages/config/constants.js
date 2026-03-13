/** 向量检索：相似度与时间权重 */
const VECTOR_SIMILARITY_WEIGHT = 0.7;
const VECTOR_TIME_WEIGHT = 0.3;

/** nomic-embed-text 前缀 */
const SEARCH_DOCUMENT_PREFIX = 'search_document: ';
const SEARCH_QUERY_PREFIX = 'search_query: ';

/** 对话块：最近几轮参与拼接 */
const DIALOGUE_CHUNK_PREV_ROUNDS = 1;

/** 摘要间隔（轮数），0 表示不启用周期摘要 */
const SUMMARY_EVERY_N_ROUNDS = 0;

module.exports = {
  VECTOR_SIMILARITY_WEIGHT,
  VECTOR_TIME_WEIGHT,
  SEARCH_DOCUMENT_PREFIX,
  SEARCH_QUERY_PREFIX,
  DIALOGUE_CHUNK_PREV_ROUNDS,
  SUMMARY_EVERY_N_ROUNDS,
};
