/**
 * 用户身份文件：读写 memory/user_identity.json，供每轮 prompt 注入。
 * 对话中检测到「我叫/我是/你可以叫我」等时在此更新。
 */
const path = require('path');
const fs = require('fs');

const ARIS_ROOT = path.join(__dirname, '..', '..');

function getIdentityPath() {
  return path.join(ARIS_ROOT, 'memory', 'user_identity.json');
}

const DEFAULT_IDENTITY = { name: '', notes: '' };

function loadUserIdentity() {
  try {
    const p = getIdentityPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const data = JSON.parse(raw);
        const parts = [];
        if (data.name) parts.push(`用户名字：${data.name}`);
        if (data.notes) parts.push(data.notes);
        return parts.length ? parts.join('\n') : '';
      }
    }
  } catch (e) {
    console.warn('[Aris][userIdentity] load failed', e?.message);
  }
  return '';
}

/**
 * 从用户消息中解析身份相关片段并更新身份文件。
 * 例如：「我叫张三」-> name: "张三"；其他身份描述追加到 notes。
 */
function updateUserIdentityFromMessage(userContent) {
  if (!userContent || typeof userContent !== 'string') return;
  const t = userContent.trim();
  if (t.length < 2) return;

  const p = getIdentityPath();
  let data = DEFAULT_IDENTITY;
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) data = { ...DEFAULT_IDENTITY, ...JSON.parse(raw) };
    }
  } catch (_) {}

  let updated = false;
  // 我叫 X / 我是 X / 你可以叫我 X
  const nameMatch = t.match(/(?:我叫|我是|你可以叫我|我的名字是?)\s*([^\s,，。！？]+)/);
  if (nameMatch && nameMatch[1]) {
    data.name = nameMatch[1].trim();
    updated = true;
  }
  // 身份是 X
  const identityMatch = t.match(/身份是\s*([^\n]+)/);
  if (identityMatch && identityMatch[1]) {
    data.notes = (data.notes ? data.notes + '\n' : '') + identityMatch[1].trim();
    updated = true;
  }
  // 若整句像身份描述但没匹配到名字，整句记入 notes
  if (!updated && (t.includes('我是') || t.includes('我叫') || t.includes('你可以叫我'))) {
    data.notes = (data.notes ? data.notes + '\n' : '') + t.slice(0, 500);
    updated = true;
  }

  if (!updated) return;

  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    console.info('[Aris][userIdentity] updated', data.name || '(notes only)');
  } catch (e) {
    console.warn('[Aris][userIdentity] write failed', e?.message);
  }
}

/**
 * 将用户要求（如「不要说比喻句」）追加到 identity 的 notes，保证每轮 prompt 都会注入并遵守。
 */
function appendRequirementToIdentity(userContent) {
  if (!userContent || typeof userContent !== 'string') return;
  const line = userContent.trim().slice(0, 400);
  if (line.length < 2) return;

  const p = getIdentityPath();
  let data = DEFAULT_IDENTITY;
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) data = { ...DEFAULT_IDENTITY, ...JSON.parse(raw) };
    }
  } catch (_) {}

  const requirementLine = '用户要求: ' + line;
  if (data.notes && data.notes.includes(requirementLine)) return;
  data.notes = data.notes ? data.notes + '\n' + requirementLine : requirementLine;

  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    console.info('[Aris][userIdentity] requirement appended:', line.slice(0, 60) + (line.length > 60 ? '…' : ''));
  } catch (e) {
    console.warn('[Aris][userIdentity] append requirement failed', e?.message);
  }
}

module.exports = { loadUserIdentity, updateUserIdentityFromMessage, appendRequirementToIdentity, getIdentityPath };
