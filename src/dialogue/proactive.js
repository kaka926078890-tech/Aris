/**
 * Aris proactive: state-driven decision to send a message (no fixed rules like "idle N min").
 * Called periodically from main; uses LLM to decide whether to speak and what to say.
 */
const { chat } = require('./api.js');
const { buildStatePrompt } = require('./prompt.js');
const { getRecent } = require('../store/conversations.js');
const { getCurrentSessionId } = require('../store/conversations.js');
const { retrieve } = require('../memory/retrieval.js');
const { getActiveWindowTitle } = require('../context/windowTitle.js');
const { append } = require('../store/conversations.js');
const { addMemory } = require('../memory/lancedb.js');
const { embed } = require('../memory/embedding.js');

async function maybeProactiveMessage() {
  try {
    const sessionId = await getCurrentSessionId();
    const recent = await getRecent(sessionId, 10);
    const windowTitle = getActiveWindowTitle();
    const contextSummary = [
      '近期对话（最近几轮）：',
      recent.map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`).join('\n'),
      '当前用户窗口：' + (windowTitle || '（未知）'),
    ].join('\n');

    const memories = await retrieve(contextSummary.slice(0, 500), 3);
    const memoryText = memories.length ? memories.map((m) => m.text).join(' | ') : '（无）';
    const fullContext = contextSummary + '\n\n相关记忆：' + memoryText;

    const messages = [
      { role: 'system', content: buildStatePrompt(fullContext) },
      { role: 'user', content: '请根据上述上下文，输出你的当前情绪/想法，以及是否想主动说一句话及内容。' },
    ];

    const { content } = await chat(messages);
    // 思考过程：LLM 返回的整段（情绪与想法 + 是否想说话 + 内容）打 log，便于排查/观察
    if (content) {
      console.info('[Aris][proactive] 思考过程:\n' + content);
    }
    if (!content || content.includes('是否想说话：否')) return null;
    const match = content.match(/若想说话，内容[：:]\s*([^\n]+)/) || content.match(/内容[：:]\s*([^\n]+)/);
    const line = match ? match[1].trim() : content.split('\n').pop().trim();
    if (line.length > 5 && line.length < 200) {
      // 若上一条已是助手消息且内容与本次相同或高度相似，不再重复发送
      const last = recent.length > 0 ? recent[recent.length - 1] : null;
      if (last && last.role === 'assistant') {
        const lastText = (last.content || '').trim();
        if (lastText === line || lastText.includes(line) || line.includes(lastText)) {
          console.info('[Aris][proactive] 跳过重复：上条已是相同/相似内容');
          return null;
        }
      }
      await append(sessionId, 'assistant', line);
      const vec = await embed(`Aris 主动: ${line}`);
      if (vec) await addMemory({ text: `Aris 主动: ${line}`, vector: vec, type: 'aris_behavior' });
      return line;
    }
    return null;
  } catch (e) {
    console.warn('Proactive check failed', e);
    return null;
  }
}

module.exports = { maybeProactiveMessage };
