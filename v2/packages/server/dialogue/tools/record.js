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
];

async function runRecordTool(name, args) {
  const a = args || {};
  try {
    if (name === 'record_user_identity') {
      store.identity.writeIdentity({ name: a.name, notes: a.notes });
      return { ok: true, message: '已记录' };
    }
    if (name === 'record_user_requirement') {
      if (a.text) store.requirements.appendRequirement(a.text);
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
  } catch (e) {
    console.warn('[Aris v2] record tool error', name, e?.message);
    return { ok: false, error: e?.message };
  }
  return { ok: false, error: 'Unknown tool' };
}

module.exports = { RECORD_TOOLS, runRecordTool };
