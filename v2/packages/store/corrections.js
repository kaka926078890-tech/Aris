/**
 * 纠错：仅被 record_correction 工具或管理 API 调用。
 */
const fs = require('fs');
const { getCorrectionsPath, getMemoryDir } = require('../config/paths.js');

function _readList() {
  try {
    const p = getCorrectionsPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8').trim();
      if (raw) {
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      }
    }
  } catch (e) {
    console.warn('[Aris v2][store/corrections] read failed', e?.message);
  }
  return [];
}

function appendCorrection(previous, correction) {
  const text = `[纠错] 我此前说: ${String(previous ?? '').slice(0, 500)}\n用户纠正: ${String(correction ?? '').slice(0, 500)}`;
  const list = _readList();
  const item = { text, created_at: new Date().toISOString() };
  list.push(item);
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCorrectionsPath(), JSON.stringify(list, null, 2), 'utf8');
  const timeline = require('./timeline.js');
  timeline.appendEntry({ type: 'correction', payload: item, actor: 'system' });
  console.info('[Aris v2][store/corrections] appended');
  try {
    require('./constraints_brief.js').scheduleRebuild();
  } catch (_) {}
  setImmediate(() => {
    const Refiner = require('./requirements_refiner.js');
    const refiner = new Refiner();
    const withMeta = getRecentWithMeta(0);
    const texts = withMeta.map((x) => x.text).filter(Boolean);
    if (texts.length) {
      refiner.refineToDocument(texts, 'corrections').then((doc) => {
        if (doc) replaceWithDocument(doc);
        console.info('[Aris v2][store/corrections] 已自动总结为文档');
      }).catch((e) => console.warn('[Aris v2][store/corrections] 自动总结失败', e?.message));
    }
  });
}

function getRecent(limit = 10) {
  const list = _readList();
  const slice = limit ? list.slice(-limit) : list;
  return slice.map((x) => (typeof x === 'string' ? x : x?.text)).filter(Boolean);
}

/** 返回带 created_at 的完整项，供管理页展示与编辑。limit 0 表示全部 */
function getRecentWithMeta(limit = 0) {
  const list = _readList();
  const slice = limit ? list.slice(-limit) : list;
  return slice.map((x) => {
    if (typeof x === 'string') return { text: x, created_at: new Date().toISOString() };
    return { text: x?.text || '', created_at: x?.created_at || new Date().toISOString() };
  }).filter((x) => x.text != null && String(x.text).trim() !== '');
}

/** 整体替换纠错列表（管理页编辑后保存）。items: [{ text, created_at? }] */
function replaceAll(items) {
  const list = Array.isArray(items) ? items : [];
  const normalized = list.map((x) => ({
    text: String(x?.text ?? '').trim() || '',
    created_at: x?.created_at || new Date().toISOString(),
  })).filter((x) => x.text !== '');
  const dir = getMemoryDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getCorrectionsPath(), JSON.stringify(normalized, null, 2), 'utf8');
  console.info('[Aris v2][store/corrections] replaceAll', normalized.length);
}

/** 文档式总结：合并为一份文档后存为单条。由外部传入 refiner.refineToDocument 结果 */
async function replaceWithDocument(docString) {
  const text = String(docString ?? '').trim();
  if (!text) return;
  replaceAll([{ text, created_at: new Date().toISOString() }]);
  try {
    require('./constraints_brief.js').scheduleRebuild();
  } catch (_) {}
}

module.exports = { appendCorrection, getRecent, getRecentWithMeta, replaceAll, replaceWithDocument };
