/**
 * Aris proactive: state-driven decision to send a message (no fixed rules like "idle N min").
 * Called periodically from main; uses LLM to decide whether to speak and what to say.
 */
const { chat } = require('./api.js');
const { buildStatePrompt } = require('./prompt.js');
const { getRecent } = require('../store/conversations.js');
const { getCurrentSessionId } = require('../store/conversations.js');
const { retrieve, retrieveByTypes } = require('../memory/retrieval.js');
const { getActiveWindowTitle } = require('../context/windowTitle.js');
const { append } = require('../store/conversations.js');
const { addMemory } = require('../memory/lancedb.js');
const { embed } = require('../memory/embedding.js');

async function maybeProactiveMessage() {
  try {
    const sessionId = await getCurrentSessionId();
    const recent = await getRecent(sessionId, 10);
    const windowTitle = getActiveWindowTitle();
    
    // 先检索aris_emotion类型的记忆，获取真实的情感积累
    const emotionMemories = await retrieveByTypes(['aris_emotion'], 5);
    const emotionText = emotionMemories.length 
      ? emotionMemories.map((m) => m.text).join(' | ')
      : '（暂无情感记录）';
    
    const contextSummary = [
      '近期对话（最近几轮）：',
      recent.map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`).join('\n'),
      '当前用户窗口：' + (windowTitle || '（未知）'),
      '\n情感积累记录：',
      emotionText,
    ].join('\n');

    const memories = await retrieve(contextSummary.slice(0, 500), 3);
    const memoryText = memories.length ? memories.map((m) => m.text).join(' | ') : '（无）';
    const fullContext = contextSummary + '\n\n相关记忆：' + memoryText;

    const messages = [
      { role: 'system', content: buildStatePrompt(fullContext) },
      { role: 'user', content: '请根据上述上下文，特别是情感积累记录，输出你的当前情绪/想法，以及是否想主动说一句话及内容。' },
    ];

    const { content } = await chat(messages);
    // 思考过程：LLM 返回的整段（情绪与想法 + 是否想说话 + 内容）打 log，便于排查/观察
    if (content) {
      console.info('[Aris][proactive] 思考过程:\n' + content);
    }
    if (!content || content.includes('是否想说话：否')) {
      return null;
    }
    const match = content.match(/若想说话，内容[：:]\s*([^\n]+)/) || content.match(/内容[：:]\s*([^\n]+)/);
    const line = match ? match[1].trim() : content.split('\n').pop().trim();
    if (line.length <= 5 || line.length >= 200) {
      return null;
    }
    const normalize = (s) => (s || '').replace(/[，。？、\s]/g, '').trim();
    const recentAssistant = recent.filter((r) => r.role === 'assistant').slice(-5);
    const lineNorm = normalize(line);
    for (const msg of recentAssistant) {
      const prev = normalize((msg.content || '').trim());
      if (prev.length < 10) continue;
      if (lineNorm === prev || lineNorm.includes(prev) || prev.includes(lineNorm)) {
        console.info('[Aris][proactive] 跳过重复：与近期某条助手消息相同/相似');
        return null;
      }
    }
    await append(sessionId, 'assistant', line);
    const vec = await embed(`Aris 主动: ${line}`);
    if (vec) await addMemory({ text: `Aris 主动: ${line}`, vector: vec, type: 'aris_behavior' });
    console.info('[Aris][proactive] 已发送:', line.slice(0, 50) + (line.length > 50 ? '…' : ''));
    return line;
  } catch (e) {
    console.warn('[Aris][proactive] 检查失败', e);
    return null;
  }
}

module.exports = { maybeProactiveMessage };
