/**
 * 用户要求总结：从 user_requirement 向量记忆与 identity notes 中的「用户要求」合并为一份完整总结，
 * 写入 memory/user_requirements_summary.md，供每轮 prompt 注入【用户要求】。
 */
const path = require('path');
const fs = require('fs');
const { getRecentByTypes } = require('../memory/lancedb.js');
const { recordFileModification } = require('../store/monitor.js');

const ARIS_ROOT = path.join(__dirname, '..', '..');
const SUMMARY_PATH = path.join(ARIS_ROOT, 'memory', 'user_requirements_summary.md');

/**
 * 读取当前「用户要求总结」文件内容；不存在或空则返回空字符串。
 */
function loadUserRequirementsSummary() {
  try {
    if (fs.existsSync(SUMMARY_PATH)) {
      const raw = fs.readFileSync(SUMMARY_PATH, 'utf8').trim();
      return raw || '';
    }
  } catch (e) {
    console.warn('[Aris][userRequirementsSummary] load failed', e?.message);
  }
  return '';
}

/**
 * 从 identity 的 notes 中提取「用户要求: xxx」行。
 */
function extractRequirementsFromIdentityNotes() {
  const identityPath = path.join(ARIS_ROOT, 'memory', 'user_identity.json');
  const lines = [];
  try {
    if (fs.existsSync(identityPath)) {
      const raw = fs.readFileSync(identityPath, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        const notes = (data.notes || '').trim();
        notes.split('\n').forEach((line) => {
          const t = line.trim();
          if (t.startsWith('用户要求:') || t.startsWith('用户要求：')) {
            lines.push(t.replace(/^用户要求[：:]\s*/, '').trim());
          }
        });
      }
    }
  } catch (_) {}
  return lines;
}

/**
 * 合并 user_requirement 记忆与 identity 中的要求，去重、排序后写回总结文件。
 * 不删减内容，只做合并与排序。
 */
async function updateUserRequirementsSummary() {
  const [vectorRequirements, identityLines] = await Promise.all([
    getRecentByTypes(['user_requirement'], 50),
    Promise.resolve(extractRequirementsFromIdentityNotes()),
  ]);
  const texts = [];
  const seen = new Set();
  for (const r of vectorRequirements || []) {
    const t = typeof r.text === 'string' ? r.text : String(r?.text ?? '').trim();
    const normalized = t.replace(/^用户要求[：:]\s*/, '').trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      texts.push(normalized);
    }
  }
  for (const line of identityLines) {
    if (line && !seen.has(line)) {
      seen.add(line);
      texts.push(line);
    }
  }
  const summary = texts.length ? texts.map((t, i) => `${i + 1}. ${t}`).join('\n') : '';
  try {
    const dir = path.dirname(SUMMARY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(SUMMARY_PATH, summary, 'utf8');
    recordFileModification('memory/user_requirements_summary.md');
    if (texts.length) {
      console.info('[Aris][userRequirementsSummary] updated, items=', texts.length);
    }
  } catch (e) {
    console.warn('[Aris][userRequirementsSummary] write failed', e?.message);
  }
}

module.exports = { loadUserRequirementsSummary, updateUserRequirementsSummary, SUMMARY_PATH };
