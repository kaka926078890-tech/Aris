/**
 * 记录类工具：仅当 LLM 调用时写入 store，不解析用户消息。
 */
const store = require('../../../store');

const RECORD_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'record_user_identity',
      description: '记录用户告知的身份信息（如姓名、备注）。仅在用户明确说出「我叫/我是/你可以叫我」等时调用。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '用户姓名或称呼' },
          notes: { type: 'string', description: '其他身份备注' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_user_identity',
      description: '获取用户身份信息（姓名和备注）。在需要了解用户身份时调用。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_user_requirement',
      description: '记录用户提出的偏好或要求（如「不要比喻句」「记住我喜欢简洁」）。仅在用户明确表达偏好/要求时调用。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '用户要求内容' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_correction',
      description: '记录用户对之前回复的纠正（如「你理解错了」「不是这个意思」）。',
      parameters: {
        type: 'object',
        properties: {
          previous: { type: 'string', description: '你之前说的或理解的内容' },
          correction: { type: 'string', description: '用户的纠正内容' },
        },
        required: ['previous', 'correction'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_emotion',
      description: '记录你当前的情感或观察（用于后续主动表达）。可选调用。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '简短情感或观察描述' },
          intensity: { type: 'number', description: '1-5 强度', default: 3 },
          tags: { type: 'array', items: { type: 'string' }, description: '情感标签' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_expression_desire',
      description: '记录你想主动对用户说的一句话（用于后续主动发送）。可选调用。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '想说的内容' },
          intensity: { type: 'number', description: '1-5 强度', default: 3 },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_association',
      description: '建立两条信息之间的关联（如身份与偏好、要求与要求）。用于形成用户认知图。',
      parameters: {
        type: 'object',
        properties: {
          source_type: { type: 'string', description: '来源类型，如 identity / requirement' },
          source_id: { type: 'string', description: '来源 id 或键，如 name 或 req_xxx' },
          target_type: { type: 'string', description: '目标类型' },
          target_id: { type: 'string', description: '目标 id 或键' },
          relationship: { type: 'string', description: '关系描述，如 prefers / related_to' },
          strength: { type: 'number', description: '关联强度 0-1', default: 1 },
        },
        required: ['source_type', 'source_id', 'target_type', 'target_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_associations',
      description: '查询某条信息的所有关联（如某身份关联了哪些要求）。',
      parameters: {
        type: 'object',
        properties: {
          source_type: { type: 'string', description: '来源类型' },
          source_id: { type: 'string', description: '来源 id 或键' },
        },
        required: ['source_type', 'source_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_preference',
      description: '记录用户喜好或习惯（如喜欢的游戏、何时容易累、希望安静等）。仅在用户明确说出时调用。',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: '类别：如 game / rest / quiet / food' },
          summary: { type: 'string', description: '简短描述' },
          source: { type: 'string', description: '来源（可选）' },
          tags: { type: 'array', items: { type: 'string' }, description: '标签（可选）' },
        },
        required: ['topic', 'summary'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_preferences',
      description: '获取用户已记录的喜好与习惯（如游戏、休息/安静偏好等）。需要了解用户偏好时调用。',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: '可选，按类别筛选如 game / rest / quiet' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'record_friend_context',
      description: '记录当前对话中的心情或场景（如「今天加班很累」「想静静」），用于后续主动消息时参考。',
      parameters: {
        type: 'object',
        properties: {
          mood_or_scene: { type: 'string', description: '简短心情或场景描述' },
        },
        required: ['mood_or_scene'],
      },
    },
  },
];

async function runRecordTool(name, args) {
  const a = args || {};
  try {
    if (name === 'record_user_identity') {
      store.identity.writeIdentity({ name: a.name, notes: a.notes });
      return { ok: true, message: '已记录' };
    }
    if (name === 'get_user_identity') {
      const identity = store.identity.readIdentity();
      return { ok: true, identity };
    }
    if (name === 'record_user_requirement') {
      if (a.text) {
        const res = await store.requirements.appendRequirement(a.text);
        return { ok: !!res?.success, message: res?.message || '已记录' };
      }
      return { ok: true, message: '已记录' };
    }
    if (name === 'record_correction') {
      if (a.previous != null && a.correction != null) store.corrections.appendCorrection(a.previous, a.correction);
      return { ok: true, message: '已记录' };
    }
    if (name === 'record_emotion') {
      if (a.text) store.emotions.appendEmotion({ text: a.text, intensity: a.intensity, tags: a.tags });
      return { ok: true, message: '已记录' };
    }
    if (name === 'record_expression_desire') {
      if (a.text) store.expressionDesires.appendDesire({ text: a.text, intensity: a.intensity });
      return { ok: true, message: '已记录' };
    }
    if (name === 'record_association') {
      const res = store.associations.addAssociation({
        source_type: a.source_type,
        source_id: a.source_id,
        target_type: a.target_type,
        target_id: a.target_id,
        relationship: a.relationship,
        strength: a.strength,
      });
      return res;
    }
    if (name === 'get_associations') {
      const list = store.associations.getAssociationsFor(a.source_type, a.source_id);
      return { ok: true, associations: list };
    }
    if (name === 'record_preference') {
      const res = store.preferences.add({
        topic: a.topic,
        summary: a.summary,
        source: a.source,
        tags: a.tags,
      });
      if (res.success && a.topic) {
        const t = String(a.topic).toLowerCase();
        if (t === 'rest' || t === 'quiet') {
          store.state.writeProactiveState({ last_tired_or_quiet_at: new Date().toISOString() });
        }
      }
      return res.success ? { ok: true, message: '已记录', id: res.id } : { ok: false, error: res.message };
    }
    if (name === 'get_preferences') {
      const list = store.preferences.listByTopic(a.topic, 20);
      const summary = store.preferences.getSummaryForPrompt({ topic: a.topic, maxLines: 15 });
      return { ok: true, preferences: list, summary_for_prompt: summary };
    }
    if (name === 'record_friend_context') {
      if (a.mood_or_scene != null && String(a.mood_or_scene).trim()) {
        const text = String(a.mood_or_scene).trim();
        store.state.writeProactiveState({ recent_mood_or_scene: text });
        const lower = text.toLowerCase();
        if (/累|困|想静静|安静|别打扰|休息/.test(lower)) {
          store.state.writeProactiveState({ last_tired_or_quiet_at: new Date().toISOString() });
        }
      }
      return { ok: true, message: '已记录' };
    }
  } catch (e) {
    console.warn('[Aris v2] record tool error', name, e?.message);
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { RECORD_TOOLS, runRecordTool };