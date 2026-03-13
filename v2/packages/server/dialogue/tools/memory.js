/**
 * 记忆检索：search_memories、get_corrections。
 */
const store = require('../../../store');

const MEMORY_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_memories',
      description: '按语义检索与 query 相关的记忆（对话、偏好等）。需要回忆时调用。',
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
];

async function runMemoryTool(name, args) {
  const a = args || {};
  try {
    if (name === 'search_memories') {
      if (!store.vector) {
        console.info('[Aris v2] 召回: 向量库未就绪');
        return { ok: true, memories: [], text: '（向量库未就绪）' };
      }
      const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 15);
      const rows = await store.vector.search(a.query || '', limit);
      const texts = rows.map((r) => r.text).filter(Boolean);
      console.info('[Aris v2] 召回:', texts.length, '条, query=', (a.query || '').slice(0, 40));
      return { ok: true, memories: texts, text: texts.length ? texts.join('\n---\n') : '（无相关记忆）' };
    }
    if (name === 'get_corrections') {
      const limit = Math.min(Math.max(Number(a.limit) || 5, 1), 10);
      const list = store.corrections.getRecent(limit);
      return { ok: true, corrections: list, text: list.length ? list.join('\n---\n') : '（暂无纠错记录）' };
    }
  } catch (e) {
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { MEMORY_TOOLS, runMemoryTool };
