/**
 * v2 数据与 memory 路径。与现网隔离，不使用项目根 src/ 或现有 userData/aris。
 */
const path = require('path');
const fs = require('fs');

function getV2Root() {
  return path.join(__dirname, '..', '..');
}

function getDataDir() {
  if (process.env.ARIS_V2_DATA_DIR) {
    return path.resolve(process.env.ARIS_V2_DATA_DIR);
  }
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'aris-v2');
  } catch (_) {
    return path.join(getV2Root(), 'data');
  }
}

function getMemoryDir() {
  const base = getDataDir();
  const memoryDir = path.join(base, 'memory');
  if (!fs.existsSync(memoryDir)) {
    fs.mkdirSync(memoryDir, { recursive: true });
  }
  return memoryDir;
}

function getIdentityPath() {
  return path.join(getMemoryDir(), 'identity.json');
}

function getRequirementsPath() {
  return path.join(getMemoryDir(), 'requirements.json');
}

function getCorrectionsPath() {
  return path.join(getMemoryDir(), 'corrections.json');
}

function getEmotionsPath() {
  return path.join(getMemoryDir(), 'emotions.json');
}

function getExpressionDesiresPath() {
  return path.join(getMemoryDir(), 'expression_desires.json');
}

function getSqlitePath() {
  return path.join(getDataDir(), 'aris.db');
}

function getLanceDbPath() {
  return path.join(getDataDir(), 'lancedb');
}

function getStatePath() {
  return path.join(getDataDir(), 'aris_state.json');
}

function getProactiveStatePath() {
  return path.join(getDataDir(), 'aris_proactive_state.json');
}

module.exports = {
  getV2Root,
  getDataDir,
  getMemoryDir,
  getIdentityPath,
  getRequirementsPath,
  getCorrectionsPath,
  getEmotionsPath,
  getExpressionDesiresPath,
  getSqlitePath,
  getLanceDbPath,
  getStatePath,
  getProactiveStatePath,
};
