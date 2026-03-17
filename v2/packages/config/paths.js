/**
 * v2 数据与 memory 路径。与现网隔离，不使用项目根 src/ 或现有 userData/aris。
 * memory 文件名从 memory_files.json 读取，不硬编码。
 */
const path = require('path');
const fs = require('fs');

let memoryFiles = null;
function getMemoryFiles() {
  if (memoryFiles) return memoryFiles;
  try {
    memoryFiles = require('./memory_files.json');
  } catch (_) {
    memoryFiles = {
      identity: 'identity.json',
      requirements: 'requirements.json',
      corrections: 'corrections.json',
      emotions: 'emotions.json',
      expression_desires: 'expression_desires.json',
      associations: 'associations.json',
      quiet_phrases: 'quiet_phrases.json',
      retrieval_config: 'retrieval_config.json',
      session_summaries: 'session_summaries.json',
      preferences: 'preferences.json',
      network_config: 'network_config.json',
    };
  }
  return memoryFiles;
}

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
  return path.join(getMemoryDir(), getMemoryFiles().identity);
}

function getRequirementsPath() {
  return path.join(getMemoryDir(), getMemoryFiles().requirements);
}

function getCorrectionsPath() {
  return path.join(getMemoryDir(), getMemoryFiles().corrections);
}

function getEmotionsPath() {
  return path.join(getMemoryDir(), getMemoryFiles().emotions);
}

function getExpressionDesiresPath() {
  return path.join(getMemoryDir(), getMemoryFiles().expression_desires);
}

function getAssociationsPath() {
  return path.join(getMemoryDir(), getMemoryFiles().associations);
}

function getQuietPhrasesPath() {
  const name = getMemoryFiles().quiet_phrases || 'quiet_phrases.json';
  return path.join(getMemoryDir(), name);
}

function getRetrievalConfigPath() {
  const name = getMemoryFiles().retrieval_config || 'retrieval_config.json';
  return path.join(getMemoryDir(), name);
}

function getSessionSummariesPath() {
  const name = getMemoryFiles().session_summaries || 'session_summaries.json';
  return path.join(getMemoryDir(), name);
}

function getPreferencesPath() {
  const name = getMemoryFiles().preferences || 'preferences.json';
  return path.join(getMemoryDir(), name);
}

function getNetworkConfigPath() {
  const name = getMemoryFiles().network_config || 'network_config.json';
  return path.join(getMemoryDir(), name);
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

function getTimelinePath() {
  return path.join(getDataDir(), 'timeline.json');
}

function getProactiveStatePath() {
  return path.join(getDataDir(), 'aris_proactive_state.json');
}

function getImportantDocumentsPath() {
  return path.join(getDataDir(), 'important_documents.json');
}

function getProactiveConfigPath() {
  const name = getMemoryFiles().proactive_config || 'proactive_config.json';
  return path.join(getMemoryDir(), name);
}

function getBehaviorConfigPath() {
  const name = getMemoryFiles().behavior_config || 'behavior_config.json';
  return path.join(getMemoryDir(), name);
}

function getAvoidPhrasesPath() {
  const name = getMemoryFiles().avoid_phrases || 'avoid_phrases.json';
  return path.join(getMemoryDir(), name);
}

function getSelfNotesPath() {
  const name = getMemoryFiles().self_notes || 'self_notes.json';
  return path.join(getMemoryDir(), name);
}

function getUserProfileSummaryPath() {
  return path.join(getMemoryDir(), 'user_profile_summary.md');
}

module.exports = {
  getV2Root,
  getDataDir,
  getMemoryDir,
  getMemoryFiles,
  getIdentityPath,
  getRequirementsPath,
  getCorrectionsPath,
  getEmotionsPath,
  getExpressionDesiresPath,
  getAssociationsPath,
  getQuietPhrasesPath,
  getRetrievalConfigPath,
  getSessionSummariesPath,
  getPreferencesPath,
  getNetworkConfigPath,
  getSqlitePath,
  getLanceDbPath,
  getStatePath,
  getProactiveStatePath,
  getTimelinePath,
  getImportantDocumentsPath,
  getProactiveConfigPath,
  getBehaviorConfigPath,
  getAvoidPhrasesPath,
  getSelfNotesPath,
  getUserProfileSummaryPath,
};
