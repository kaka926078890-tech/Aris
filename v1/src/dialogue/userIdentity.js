/**
 * 用户身份文件：读写 memory/user_identity.json，供每轮 prompt 注入。
 * 对话中检测到「我叫/我是/你可以叫我」等时在此更新。
 */
const path = require('path');
const fs = require('fs');
const { recordFileModification } = require('../store/monitor.js');

const ARIS_ROOT = path.join(__dirname, '..', '..');

function getIdentityPath() {
  return path.join(ARIS_ROOT, 'memory', 'user_identity.json');
}

function getIdentityChangeLogPath() {
  return path.join(ARIS_ROOT, 'memory', 'identity_change_log.json');
}

/** 身份变更后门日志：每次写回 user_identity.json 成功时追加一条，便于观察触发场景 */
function appendIdentityChangeLog(entry) {
  try {
    const p = getIdentityChangeLogPath();
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    let list = [];
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        try {
          list = JSON.parse(raw);
          if (!Array.isArray(list)) list = [];
        } catch (_) {}
      }
    }
    list.push({
      timestamp: new Date().toISOString(),
      trigger_type: entry.trigger_type || 'user_message',
      trigger_summary: entry.trigger_summary || '',
      name_before: entry.name_before,
      name_after: entry.name_after,
    });
    fs.writeFileSync(p, JSON.stringify(list, null, 2), 'utf8');
    recordFileModification('memory/identity_change_log.json');
  } catch (e) {
    console.warn('[Aris][userIdentity] appendIdentityChangeLog failed', e?.message);
  }
}

const DEFAULT_IDENTITY = { name: '', notes: '' };

/** 明显不是人名的词（疑问/指代等），避免「我是谁」被写成用户名「谁」 */
const NOT_NAME_WORDS = new Set([
  '谁', '什么', '啥', '哪个', '怎样', '如何', '多少', '哪里', '为什么', '什么时候',
  '怎么', '咋', '啥样', '啥时候', '为啥', '咋样', '咋办', '哪个', '谁啊', '什么人',
]);

/** 整句是否为「询问身份」类问句（如「我是谁」「我叫什么」），此类不当作身份声明也不写入 notes */
function isIdentityQuestion(text) {
  if (!text || typeof text !== 'string') return false;
  const t = text.trim();
  if (/我是谁\s*[？?]?\s*$/.test(t) || /^我是谁\s*[？?]?\s*$/.test(t)) return true;
  if (/我叫什么(\s*名字?)?\s*[？?]?\s*$/.test(t) || /^我叫什么(\s*名字?)?\s*[？?]?\s*$/.test(t)) return true;
  if (/你知道我是谁|你记得我是谁|你还记得我叫什么/i.test(t)) return true;
  if (/^(谁|什么|啥)(\s*[？?！!])?\s*$/.test(t)) return true;
  return false;
}

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

  // 询问类（如「我是谁」「我叫什么」）不当作身份声明，不更新也不写 notes
  if (isIdentityQuestion(t)) return;

  let updated = false;
  // 我叫 X / 我是 X / 你可以叫我 X（排除疑问词如「谁」「什么」）
  const nameMatch = t.match(/(?:我叫|我是|你可以叫我|我的名字是?)\s*([^\s,，。！？]+)/);
  if (nameMatch && nameMatch[1]) {
    const candidate = nameMatch[1].trim();
    if (candidate && !NOT_NAME_WORDS.has(candidate)) {
      data.name = candidate;
      updated = true;
    }
  }
  // 身份是 X
  const identityMatch = t.match(/身份是\s*([^\n]+)/);
  if (identityMatch && identityMatch[1]) {
    data.notes = (data.notes ? data.notes + '\n' : '') + identityMatch[1].trim();
    updated = true;
  }
  // 若整句像身份描述但没匹配到名字，整句记入 notes（排除问句）
  if (!updated && (t.includes('我是') || t.includes('我叫') || t.includes('你可以叫我')) && !isIdentityQuestion(t)) {
    data.notes = (data.notes ? data.notes + '\n' : '') + t.slice(0, 500);
    updated = true;
  }

  if (!updated) return;

  let nameBefore = null;
  try {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.name) nameBefore = parsed.name;
      }
    }
  } catch (_) {}

  try {
    const dir = path.dirname(p);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
    recordFileModification('memory/user_identity.json');
    appendIdentityChangeLog({
      trigger_type: 'user_message',
      trigger_summary: userContent.slice(0, 200),
      name_before: nameBefore,
      name_after: data.name || null,
    });
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
    recordFileModification('memory/user_identity.json');
    console.info('[Aris][userIdentity] requirement appended:', line.slice(0, 60) + (line.length > 60 ? '…' : ''));
  } catch (e) {
    console.warn('[Aris][userIdentity] append requirement failed', e?.message);
  }
}

module.exports = { loadUserIdentity, updateUserIdentityFromMessage, appendRequirementToIdentity, getIdentityPath, isIdentityQuestion };
