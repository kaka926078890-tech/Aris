/**
 * 单轮对话观测：写入 dialogue_turn_metrics.jsonl（与 prompt_planner_metrics 并列）。
 * 默认开启；设置 ARIS_DIALOGUE_METRICS_LOG=false 可关闭。
 */
const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../../config/paths.js');

function shouldLogDialogueMetrics() {
  return process.env.ARIS_DIALOGUE_METRICS_LOG !== 'false';
}

/**
 * @param {Record<string, unknown>} entry
 */
function appendDialogueTurnMetricLine(entry) {
  if (!shouldLogDialogueMetrics()) return;
  try {
    const logPath = path.join(getDataDir(), 'dialogue_turn_metrics.jsonl');
    const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
    fs.appendFileSync(logPath, line, 'utf8');
  } catch (e) {
    console.warn('[Aris v2][dialogueMetrics] append failed', e?.message);
  }
}

module.exports = { appendDialogueTurnMetricLine, shouldLogDialogueMetrics };
