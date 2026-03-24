const fs = require('fs');
const path = require('path');
const { getDataDir } = require('../../config/paths.js');

function appendJsonl(fileName, row) {
  try {
    const dir = getDataDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, fileName);
    const line = JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n';
    fs.appendFileSync(p, line, 'utf8');
  } catch (e) {
    console.warn('[Aris v2][collabTrace] append failed', e?.message || e);
  }
}

function appendQualityJudgment(row) {
  appendJsonl('quality_judgments.jsonl', row);
}

function appendIterationTrace(row) {
  appendJsonl('iteration_traces.jsonl', row);
}

module.exports = {
  appendQualityJudgment,
  appendIterationTrace,
};
