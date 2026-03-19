/**
 * 记录类工具：抽象为 record（写）与 get_record（读）两个通用接口，按 type 分发。
 */
const fs = require('fs');
const store = require('../../../store');
const { getSelfNotesPath, getMemoryDir } = require('../../../config/paths.js');

const RECORD_TYPES_WRITE = [
  'identity', 'requirement', 'correction', 'emotion', 'expression_desire',
  'association', 'preference', 'friend_context', 'self_note',
];
const RECORD_TYPES_READ = [
  'identity', 'associations', 'preferences', 'expression_desire_context',
  'recent_emotions',
];

const RECORD_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'record',
      description: `写入一条用户或对话相关记录。type 决定含义，payload 为对应字段（只传该类型需要的字段）。
type 取值与 payload 说明：
- identity: 用户身份。payload: { name?, notes? }
- requirement: 用户要求/偏好描述。payload: { text }
- correction: 用户纠正。payload: { previous, correction }
- emotion: 当前情感/观察。payload: { text, intensity?, tags? }
- expression_desire: 想主动对用户说的话。payload: { text, intensity? }
- association: 两条信息的关联。payload: { source_type, source_id, target_type, target_id, relationship?, strength? }
- preference: 用户喜好/习惯。payload: { topic, summary, source?, tags? }
- friend_context: 当前心情或场景。payload: { mood_or_scene }
- self_note: 自我反思笔记。payload: { note }`,
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: RECORD_TYPES_WRITE, description: '记录类型' },
          payload: { type: 'object', description: '根据 type 传入对应字段，见上方说明' },
        },
        required: ['type', 'payload'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_record',
      description: `读取已保存的记录。type 决定读哪种，options 为可选筛选。
type 与 options：
- identity: 用户身份。options 无需传。
- associations: 某条信息的关联。options: { source_type, source_id }
- preferences: 用户喜好。options: { topic? } 可选按类别筛。
- expression_desire_context: 某条表达欲望当时的对话。options: { created_at, window_seconds? }
- recent_emotions: 最近情感。options: { limit? } 默认 5。`,
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: RECORD_TYPES_READ, description: '要读取的记录类型' },
          options: { type: 'object', description: '可选，根据 type 传 topic/source_type/source_id/limit/created_at/window_seconds 等' },
        },
        required: ['type'],
      },
    },
  },
];

async function runRecordTool(name, args, context) {
  const a = args || {};
  try {
    if (name === 'record') {
      const type = (a.type || '').toLowerCase();
      const p = a.payload || {};
      switch (type) {
        case 'identity':
          store.identity.writeIdentity({ name: p.name, notes: p.notes });
          return { ok: true, message: '已记录' };
        case 'requirement':
          if (p.text) {
            const res = await store.requirements.appendRequirement(p.text);
            return { ok: !!res?.success, message: res?.message || '已记录' };
          }
          return { ok: true, message: '已记录' };
        case 'correction':
          if (p.previous != null && p.correction != null) store.corrections.appendCorrection(p.previous, p.correction);
          return { ok: true, message: '已记录' };
        case 'emotion':
          if (p.text) store.emotions.appendEmotion({ text: p.text, intensity: p.intensity, tags: p.tags });
          return { ok: true, message: '已记录' };
        case 'expression_desire':
          if (p.text) {
            const sessionId = context?.sessionId ?? null;
            store.expressionDesires.appendDesire({ text: p.text, intensity: p.intensity, session_id: sessionId });
          }
          return { ok: true, message: '已记录' };
        case 'association': {
          const res = store.associations.addAssociation({
            source_type: p.source_type,
            source_id: p.source_id,
            target_type: p.target_type,
            target_id: p.target_id,
            relationship: p.relationship,
            strength: p.strength,
          });
          return res;
        }
        case 'preference': {
          const res = store.preferences.add({
            topic: p.topic,
            summary: p.summary,
            source: p.source,
            tags: p.tags,
          });
          if (res.success && p.topic) {
            const t = String(p.topic).toLowerCase();
            if (t === 'rest' || t === 'quiet') {
              store.state.writeProactiveState({ last_tired_or_quiet_at: new Date().toISOString() });
            }
          }
          return res.success ? { ok: true, message: '已记录', id: res.id } : { ok: false, error: res.message };
        }
        case 'friend_context':
          if (p.mood_or_scene != null && String(p.mood_or_scene).trim()) {
            const text = String(p.mood_or_scene).trim();
            store.state.writeProactiveState({ recent_mood_or_scene: text });
            const lower = text.toLowerCase();
            if (/累|困|想静静|安静|别打扰|休息/.test(lower)) {
              store.state.writeProactiveState({ last_tired_or_quiet_at: new Date().toISOString() });
            }
          }
          return { ok: true, message: '已记录' };
        case 'self_note': {
          const note = (p.note && String(p.note).trim()) || '';
          if (!note) return { ok: false, error: '笔记内容为空' };
          const path = getSelfNotesPath();
          const dir = getMemoryDir();
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          let list = [];
          if (fs.existsSync(path)) {
            try {
              const raw = fs.readFileSync(path, 'utf8').trim();
              if (raw) list = JSON.parse(raw);
            } catch (_) {}
            if (!Array.isArray(list)) list = [];
          }
          list.push({ at: new Date().toISOString(), text: note.slice(0, 500) });
          fs.writeFileSync(path, JSON.stringify(list, null, 2), 'utf8');
          return { ok: true, message: '已记录' };
        }
        default:
          return { ok: false, error: '不支持的 record type: ' + type };
      }
    }

    if (name === 'get_record') {
      const type = (a.type || '').toLowerCase();
      const opt = a.options || {};
      switch (type) {
        case 'identity': {
          const identity = store.identity.readIdentity();
          return { ok: true, identity };
        }
        case 'associations': {
          const list = store.associations.getAssociationsFor(opt.source_type, opt.source_id);
          return { ok: true, associations: list };
        }
        case 'preferences': {
          const list = store.preferences.listByTopic(opt.topic, 20);
          const summary = store.preferences.getSummaryForPrompt({ topic: opt.topic, maxLines: 15 });
          return { ok: true, preferences: list, summary_for_prompt: summary };
        }
        case 'expression_desire_context': {
          const iso = opt.created_at;
          const windowSec = Math.min(3600, Math.max(60, Number(opt.window_seconds) || 300));
          const entries = store.timeline.getEntries({ type: 'expression_desire', limit: 50 });
          const target = new Date(iso).getTime();
          if (Number.isNaN(target)) return { ok: false, error: '无效的 created_at' };
          let best = null;
          let bestDiff = Infinity;
          for (const e of entries) {
            const t = e.payload?.created_at ? new Date(e.payload.created_at).getTime() : NaN;
            if (Number.isNaN(t)) continue;
            const diff = Math.abs(t - target);
            if (diff < bestDiff) {
              bestDiff = diff;
              best = e;
            }
          }
          if (!best?.payload?.session_id) {
            return { ok: true, messages: [], text: '（未找到该时间对应的表达欲望或缺少 session，无法按时间查对话）' };
          }
          const messages = await store.conversations.getConversationAroundTime(
            best.payload.session_id,
            best.payload.created_at,
            windowSec
          );
          const text = messages.length
            ? messages.map((m) => `${m.role === 'user' ? '用户' : 'Aris'}: ${(m.content || '').slice(0, 500)}`).join('\n')
            : '（该时间窗口内无对话记录）';
          return { ok: true, messages, text };
        }
        case 'recent_emotions': {
          const limit = Math.min(Math.max(Number(opt.limit) || 5, 1), 10);
          const list = store.emotions.getRecent(limit);
          const text = list.length ? list.map((e) => `[强度${e.intensity ?? 3}] ${(e.text || '').slice(0, 100)}`).join('\n') : '（暂无情感记录）';
          return { ok: true, emotions: list, text };
        }
        default:
          return { ok: false, error: '不支持的 get_record type: ' + type };
      }
    }
  } catch (e) {
    console.warn('[Aris v2] record tool error', name, e?.message);
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { RECORD_TOOLS, runRecordTool };
