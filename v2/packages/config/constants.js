/** 向量检索：相似度与时间权重（最终排序默认「相关性优先」：时间权重为 0；可用环境变量覆盖） */
const VECTOR_SIMILARITY_WEIGHT = 1;
const VECTOR_TIME_WEIGHT = 0;

/** nomic-embed-text 前缀 */
const SEARCH_DOCUMENT_PREFIX = 'search_document: ';
const SEARCH_QUERY_PREFIX = 'search_query: ';

/** 对话块：最近几轮参与拼接 */
const DIALOGUE_CHUNK_PREV_ROUNDS = 1;

/** 摘要间隔（轮数），0 表示不启用周期摘要 */
const SUMMARY_EVERY_N_ROUNDS = 0;

/**
 * 单条用户消息触发的工具循环中，「文件类」工具最大调用次数（含 list/read/cache/write/delete/get_my_context 等）。
 * 可通过 ARIS_FILE_TOOL_MAX_PER_USER_TURN 配置（默认放宽；上限防误配爆炸）。
 */
function getFileToolMaxPerUserTurn() {
  const n = Number(process.env.ARIS_FILE_TOOL_MAX_PER_USER_TURN);
  if (!Number.isNaN(n) && n >= 1) return Math.min(Math.floor(n), 100000);
  return 1000;
}

/** @type {ReadonlySet<string>} */
const FILE_TOOL_NAMES = new Set([
  'list_my_files',
  'get_dir_cache',
  'get_read_file_cache',
  'get_recent_read_file_cache',
  'read_file',
  'write_file',
  'delete_file',
  'get_my_context',
  'search_repo_text',
]);

function isFileToolName(name) {
  return typeof name === 'string' && FILE_TOOL_NAMES.has(name);
}

/** 主对话工具循环最大轮数（含工具调用）。可通过 ARIS_MAX_TOOL_ROUNDS 配置，默认 25。 */
function getMaxToolRounds() {
  const n = Number(process.env.ARIS_MAX_TOOL_ROUNDS);
  if (!Number.isNaN(n) && n >= 1 && n <= 500) return Math.floor(n);
  return 25;
}

/** read_file 单次返回最大字符数（截断）；可用 ARIS_READ_FILE_MAX_CHARS，默认约 200 万。 */
function getReadFileMaxChars() {
  const n = Number(process.env.ARIS_READ_FILE_MAX_CHARS);
  if (!Number.isNaN(n) && n >= 1) return Math.min(Math.floor(n), 20000000);
  return 2000000;
}

module.exports = {
  VECTOR_SIMILARITY_WEIGHT,
  VECTOR_TIME_WEIGHT,
  SEARCH_DOCUMENT_PREFIX,
  SEARCH_QUERY_PREFIX,
  DIALOGUE_CHUNK_PREV_ROUNDS,
  SUMMARY_EVERY_N_ROUNDS,
  getFileToolMaxPerUserTurn,
  /** @deprecated 使用 getFileToolMaxPerUserTurn() */
  get FILE_TOOL_MAX_PER_USER_TURN() {
    return getFileToolMaxPerUserTurn();
  },
  FILE_TOOL_NAMES,
  isFileToolName,
  getMaxToolRounds,
  getReadFileMaxChars,
};
