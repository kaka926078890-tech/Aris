/**
 * 用户约束「二次摘要」：专供主对话 system 的 brief 层；完整文档仍在 requirements/corrections/preferences。
 * 在纠错/要求/喜好合并为文档后异步重建；无 API 时回退为截断全文。
 */
const fs = require('fs');
const path = require('path');
const { getConstraintsBriefPath } = require('../config/paths.js');
const requirements = require('./requirements.js');
const corrections = require('./corrections.js');
const preferences = require('./preferences.js');

let chatFn = null;
try {
  chatFn = require('../server/llm/client.js').chat;
} catch (_) {}

let debounceTimer = null;
const DEBOUNCE_MS = 2000;

/** 并发去重：多路同时 buildContextDTO 时共用一个重建 Promise */
let ensureInFlight = null;

function hasConstraintSources() {
  const req = _requirementsSummary();
  const corr = _correctionsFullSummary();
  const pref = _preferencesSummary();
  return !(req === '（无）' && corr === '（无）' && pref === '（无）');
}

function isBriefMissingOrEmpty(brief) {
  if (!brief || typeof brief !== 'object') return true;
  const val = (k) => String(brief[k] || '').trim();
  const emptyish = (s) => !s || s === '（无）' || s === '无要点';
  return (
    emptyish(val('requirements_brief')) &&
    emptyish(val('corrections_brief')) &&
    emptyish(val('preferences_brief'))
  );
}

/**
 * 存在要求/纠错/喜好长文，但磁盘上摘要缺失或三块皆空时，立即重建一版（await LLM 或截断回退）。
 * 在 buildContextDTO 开头 await，保证本轮已写入 constraints_brief.json（若可写）。
 */
async function ensureBriefIfNeeded() {
  if (!hasConstraintSources()) return;
  const brief = readBrief();
  if (!isBriefMissingOrEmpty(brief)) return;
  if (!ensureInFlight) {
    ensureInFlight = rebuildBriefNow().finally(() => {
      ensureInFlight = null;
    });
  }
  return ensureInFlight;
}

function _correctionsFullSummary() {
  const withMeta = corrections.getRecentWithMeta ? corrections.getRecentWithMeta(0) : [];
  if (!withMeta.length) return '（无）';
  if (withMeta.length === 1 && withMeta[0].text) {
    const raw = withMeta[0].text;
    if (raw.length > 400 || !/用户纠正[：:]|我此前说[：:]/.test(raw)) return raw;
  }
  const list = withMeta.map((x) => x.text);
  const lines = list.map((raw) => {
    const m = (raw || '').match(/用户纠正[：:]\s*([^\n]+)/);
    const correction = m ? m[1].trim().slice(0, 80) : '';
    const prev = (raw || '').match(/我此前说[：:]\s*([^\n]+)/);
    const prevText = prev ? prev[1].trim().slice(0, 50) : '';
    if (!correction) return null;
    return prevText ? `· 此前：${prevText} → 用户纠正：${correction}` : `· 用户纠正：${correction}`;
  }).filter(Boolean);
  return lines.length ? lines.join('\n') : '（无）';
}

function _preferencesSummary() {
  return preferences.getSummaryForPrompt({ maxLines: 200 }) || '（无）';
}

function _requirementsSummary() {
  return requirements.getSummary() || '（无）';
}

function _truncate(s, max) {
  const t = String(s || '').trim();
  if (!t) return '（无）';
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}

function _fallbackBrief() {
  return {
    requirements_brief: _truncate(_requirementsSummary(), 900),
    corrections_brief: _truncate(_correctionsFullSummary(), 900),
    preferences_brief: _truncate(_preferencesSummary(), 900),
    updated_at: new Date().toISOString(),
    source: 'fallback_truncate',
  };
}

/**
 * @returns {object|null} 解析后的 brief 对象；文件不存在返回 null
 */
function readBrief() {
  try {
    const p = getConstraintsBriefPath();
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8').trim();
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch (e) {
    console.warn('[Aris v2][constraints_brief] read failed', e?.message);
    return null;
  }
}

function writeBrief(data) {
  const p = getConstraintsBriefPath();
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

/**
 * 格式化为注入用文本块
 */
function formatBriefForPrompt(brief) {
  if (!brief) return '';
  const r = brief.requirements_brief || '（无）';
  const c = brief.corrections_brief || '（无）';
  const p = brief.preferences_brief || '（无）';
  return `【用户要求·摘要】\n${r}\n\n【纠错·摘要】\n${c}\n\n【用户喜好·摘要】\n${p}`;
}

/** 立即根据当前要求/纠错/喜好重建 constraints_brief.json（LLM 或截断回退）。 */
async function rebuildBriefNow() {
  const req = _requirementsSummary();
  const corr = _correctionsFullSummary();
  const pref = _preferencesSummary();
  if (req === '（无）' && corr === '（无）' && pref === '（无）') {
    writeBrief({ ..._fallbackBrief(), source: 'empty' });
    return;
  }

  if (typeof chatFn !== 'function') {
    writeBrief({ ..._fallbackBrief(), source: 'no_llm' });
    return;
  }

  const slice = (t, n) => (String(t).length > n ? String(t).slice(0, n) + '…' : t);
  const prompt = `将下列三块压缩为「供 AI 每轮扫一眼的短摘要」，**不得编造**；缺信息写「无要点」。
每块最多 8 条短句（可用「- 」开头），总字数每块不超过 500 字。只输出 JSON，不要 markdown。

【用户要求】
${slice(req, 6000)}

【纠错】
${slice(corr, 6000)}

【喜好】
${slice(pref, 6000)}

输出格式严格为：
{"requirements_brief":"...","corrections_brief":"...","preferences_brief":"..."}`;

  try {
    const res = await chatFn(
      [
        { role: 'system', content: 'You output only valid JSON objects.' },
        { role: 'user', content: prompt },
      ],
      { max_tokens: 2048, temperature: 0.3 }
    );
    if (res.error || !res.content) {
      writeBrief({ ..._fallbackBrief(), source: 'llm_error' });
      return;
    }
    let json = res.content.trim();
    if (json.startsWith('```')) {
      json = json.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
    }
    const parsed = JSON.parse(json);
    writeBrief({
      requirements_brief: String(parsed.requirements_brief || '').trim() || _truncate(req, 800),
      corrections_brief: String(parsed.corrections_brief || '').trim() || _truncate(corr, 800),
      preferences_brief: String(parsed.preferences_brief || '').trim() || _truncate(pref, 800),
      updated_at: new Date().toISOString(),
      source: 'llm_brief',
    });
    console.info('[Aris v2][constraints_brief] LLM brief 已写入');
  } catch (e) {
    console.warn('[Aris v2][constraints_brief] rebuild failed', e?.message);
    writeBrief({ ..._fallbackBrief(), source: 'parse_error' });
  }
}

function scheduleRebuild() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    rebuildBriefNow().catch((e) => console.warn('[Aris v2][constraints_brief]', e?.message));
  }, DEBOUNCE_MS);
}

module.exports = {
  readBrief,
  writeBrief,
  formatBriefForPrompt,
  rebuildBriefNow,
  scheduleRebuild,
  ensureBriefIfNeeded,
  _fallbackBrief,
};
