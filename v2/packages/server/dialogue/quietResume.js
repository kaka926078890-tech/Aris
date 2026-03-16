/**
 * 安静/恢复判断：从配置文件读取短语列表，无硬编码。
 * handler 与 proactive 共用此模块。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_QUIET_PHRASES = [
  '歇会', '安静待会', '安静待着', '别说话', '别打扰', '让我静静',
  '自己待会', '别理我', '别烦我', '需要安静', '想静静', '忙自己的事情去',
];

let cachedPhrases = null;

function getQuietPhrasesPath() {
  const { getQuietPhrasesPath: getPath } = require('../../config/paths.js');
  return getPath();
}

function readQuietPhrases() {
  if (cachedPhrases) return cachedPhrases;
  try {
    const p = getQuietPhrasesPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        const list = data.quiet_phrases;
        if (Array.isArray(list) && list.length > 0) {
          cachedPhrases = list.map((s) => String(s).trim()).filter(Boolean);
          return cachedPhrases;
        }
      }
    }
    fs.writeFileSync(p, JSON.stringify({ quiet_phrases: DEFAULT_QUIET_PHRASES }, null, 2), 'utf8');
  } catch (_) {}
  cachedPhrases = DEFAULT_QUIET_PHRASES;
  return cachedPhrases;
}

function shouldBeQuiet(userContent) {
  if (!userContent || typeof userContent !== 'string') return false;
  const phrases = readQuietPhrases();
  const contentLower = userContent.toLowerCase();
  for (const phrase of phrases) {
    if (contentLower.includes(phrase.toLowerCase())) return true;
  }
  return false;
}

function isResumingDialogue(userContent) {
  if (!userContent || typeof userContent !== 'string') return false;
  if (!userContent.trim()) return false;
  return !shouldBeQuiet(userContent);
}

function clearCache() {
  cachedPhrases = null;
}

module.exports = { shouldBeQuiet, isResumingDialogue, readQuietPhrases, clearCache };
