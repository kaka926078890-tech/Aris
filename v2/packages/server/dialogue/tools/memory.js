/**
 * 记忆检索：search_memories、get_corrections。支持按关联实体过滤（分层记忆）。
 */
const fs = require('fs');
const store = require('../../../store');
const { getUserProfileSummaryPath, getAvoidPhrasesPath } = require('../../../config/paths.js');
const { readRetrievalConfig, getCurrentRelatedEntityIds } = require('../associationContext.js');

const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_memories',
      description: '按语义检索与 query 相关的记忆（对话、偏好等）。仅做语义匹配，不按时间过滤。用户要「检索某时刻附近的对话」时请用 get_conversation_near_time。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题' },
          limit: { type: 'number', description: '最多返回条数', default: 5 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_corrections',
      description: '获取用户曾指出的纠错记录。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '最多条数', default: 5 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_conversation_near_time',
      description: '按时间查当前会话在该时刻附近的对话内容（如「16:27」「16:30」）。用户说「检索某时刻附近的记忆」时用此工具，不要用 search_memories 查时间。',
      parameters: {
        type: 'object',
        properties: {
          time_str: { type: 'string', description: '时刻，如 16:27、16:30、或 ISO 如 2026-03-16T08:27:00Z' },
          window_seconds: { type: 'number', description: '前后多少秒，默认 300（5 分钟）' },
        },
        required: ['time_str'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_avoid_phrases',
      description: '获取禁止用语列表（避免文绉绉、机械套路等）。数据来自数据目录 memory/avoid_phrases.json。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_profile_summary',
      description: '获取用户画像/主题线轻量摘要（常聊主题、近期偏好与情绪归纳）。数据来自 memory/user_profile_summary.md，可手动维护或由脚本生成。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_memories_with_time',
      description: '按语义检索记忆，并只保留在指定时间窗口内的结果（created_at 在该区间内）。用于需要「某段时间内的记忆」时。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词或问题' },
          start_time: { type: 'string', description: '时间窗口起点，ISO 如 2026-03-16T00:00:00Z 或 毫秒时间戳' },
          end_time: { type: 'string', description: '时间窗口终点，ISO 或毫秒' },
          limit: { type: 'number', description: '最多返回条数', default: 5 },
        },
        required: ['query', 'start_time', 'end_time'],
      },
    },
  },
];

async function runMemoryTool(name, args) {
  const a = args || {};
  try {
    if (name === 'search_memories') {
      if (!store.vector) {
        console.info('[Aris v2] 召回: 向量库未就绪');
        return { ok: true, memories: [], text: '（向量库未就绪）' };
      }
      const config = readRetrievalConfig();
      const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 15);
      const maxExp = Math.min(Math.max(Number(config.max_experience_results) || 10, 1), 20);
      const useLimit = config.filter_experience_by_association ? maxExp : limit;
      const filterByEntities = config.filter_experience_by_association ? getCurrentRelatedEntityIds() : undefined;
      const searchOptions = filterByEntities && filterByEntities.length > 0 ? { filterByEntities } : undefined;
      const rows = await store.vector.search(a.query || '', useLimit, searchOptions);
      const texts = rows.map((r) => r.text).filter(Boolean);
      const summaryLine = texts.length
        ? '根据检索，与当前话题相关的有：' + texts.slice(0, 2).map((t) => (t || '').trim().slice(0, 40)).filter(Boolean).join('；') + (texts.length > 2 ? '…' : '')
        : '';
      console.info('[Aris v2] 召回:', texts.length, '条, query=', (a.query || '').slice(0, 40), filterByEntities ? ', filterByEntity' : '');
      return {
        ok: true,
        memories: texts,
        text: texts.length ? texts.join('\n---\n') : '（无相关记忆）',
        summary_line: summaryLine,
      };
    }
    if (name === 'get_corrections') {
      const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 10);
      const list = store.corrections.getRecent(limit);
      return { ok: true, corrections: list, text: list.length ? list.join('\n---\n') : '（暂无纠错记录）' };
    }
    if (name === 'search_memories_with_time') {
      if (!store.vector) {
        return { ok: true, memories: [], text: '（向量库未就绪）' };
      }
      const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 15);
      const parseMs = (v) => {
        if (v == null) return NaN;
        if (typeof v === 'number' && !Number.isNaN(v)) return v < 1e13 ? v * 1000 : v;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? NaN : d.getTime();
      };
      const startMs = parseMs(a.start_time);
      const endMs = parseMs(a.end_time);
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        return { ok: false, error: 'start_time 或 end_time 无法解析，请用 ISO 或毫秒时间戳' };
      }
      const fetchLimit = limit * 2;
      const rows = await store.vector.search(a.query || '', fetchLimit);
      const timeFiltered = rows.filter((r) => {
        const t = r.created_at != null ? Number(r.created_at) : 0;
        return t >= startMs && t <= endMs;
      });
      const result = timeFiltered.length > 0 ? timeFiltered.slice(0, limit) : rows.slice(0, limit);
      const texts = result.map((r) => r.text).filter(Boolean);
      console.info('[Aris v2] 召回(带时间):', texts.length, '条, query=', (a.query || '').slice(0, 40));
      return { ok: true, memories: texts, text: texts.length ? texts.join('\n---\n') : '（无该时间范围内的相关记忆）' };
    }
    if (name === 'get_avoid_phrases') {
      const p = getAvoidPhrasesPath();
      if (fs.existsSync(p)) {
        try {
          const raw = fs.readFileSync(p, 'utf8').trim();
          const data = raw ? JSON.parse(raw) : {};
          const list = Array.isArray(data.avoid_phrases) ? data.avoid_phrases : (Array.isArray(data) ? data : []);
          const phrases = list.map((x) => (typeof x === 'string' ? x : '')).filter(Boolean);
          const text = phrases.length ? phrases.join('、') : '（未配置禁止用语列表）';
          return { ok: true, phrases, text };
        } catch (e) {
          return { ok: false, error: e?.message };
        }
      }
      return { ok: true, phrases: [], text: '（未配置禁止用语列表，可在数据目录 memory/ 下创建 avoid_phrases.json，格式：{ "avoid_phrases": ["示例1", "示例2"] }）' };
    }
    if (name === 'get_user_profile_summary') {
      const p = getUserProfileSummaryPath();
      if (fs.existsSync(p)) {
        try {
          const content = fs.readFileSync(p, 'utf8').trim();
          return { ok: true, content, text: content };
        } catch (e) {
          return { ok: false, error: e?.message };
        }
      }
      return { ok: true, content: '（暂无用户画像摘要，可手动在数据目录 memory/ 下创建 user_profile_summary.md）', text: '（暂无）' };
    }
    if (name === 'get_conversation_near_time') {
      const timeStr = (a.time_str || '').trim();
      const windowSec = Math.min(3600, Math.max(60, Number(a.window_seconds) || 300));
      if (!timeStr) return { ok: false, error: '缺少 time_str' };
      let aroundIso;
      if (/^\d{4}-\d{2}-\d{2}T/.test(timeStr) || /^\d{4}-\d{2}-\d{2}\s/.test(timeStr)) {
        try {
          aroundIso = new Date(timeStr).toISOString();
          if (Number.isNaN(new Date(timeStr).getTime())) aroundIso = null;
        } catch (_) {
          aroundIso = null;
        }
      } else {
        const match = timeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
        if (match) {
          const d = new Date();
          d.setHours(parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10) || 0, 0);
          aroundIso = d.toISOString();
        } else {
          aroundIso = null;
        }
      }
      if (!aroundIso) return { ok: false, error: '无法解析时间，请用 16:27 或 ISO 格式' };
      const sessionId = await store.conversations.getCurrentSessionId();
      const messages = await store.conversations.getConversationAroundTime(sessionId, aroundIso, windowSec);
      const text = messages.length
        ? messages.map((m) => `${m.role === 'user' ? '用户' : 'Aris'}: ${(m.content || '').slice(0, 800)}`).join('\n')
        : '（该时刻附近无对话记录，或不在当前会话）';
      return { ok: true, messages, text };
    }
  } catch (e) {
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { MEMORY_TOOLS, runMemoryTool };
