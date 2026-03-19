/**
 * v2 Store 层统一导出。对话库 SQLite、向量库 LanceDB 与 v1 一致，仅路径与封装在 v2。
 */
const identity = require('./identity.js');
const requirements = require('./requirements.js');
const associations = require('./associations.js');
const corrections = require('./corrections.js');
const emotions = require('./emotions.js');
const expressionDesires = require('./expressionDesires.js');
const conversations = require('./conversations.js');
const state = require('./state.js');
const summaries = require('./summaries.js');
const preferences = require('./preferences.js');
const timeline = require('./timeline.js');
const db = require('./db.js');
const monitor = require('./monitor.js');
const actionCache = require('./action_cache.js');

let vectorModule = null;
try {
  vectorModule = require('./vector.js');
} catch (_) {
  // vector.js 依赖 LanceDB/embed，可能未安装
}

const facade = require('./facade.js');

module.exports = {
  identity,
  requirements,
  associations,
  corrections,
  emotions,
  expressionDesires,
  conversations,
  state,
  summaries,
  preferences,
  timeline,
  vector: vectorModule,
  db,
  monitor,
  facade,
  actionCache,
};
