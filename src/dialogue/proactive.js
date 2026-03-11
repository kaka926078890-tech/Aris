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
const { readState, writeState, getSubjectiveTimeDescription } = require('../context/arisState.js');

/**
 * 计算表达欲望的优先级分数
 * @param {Object} desire - 表达欲望记录，包含 metadata.intensity 和 metadata.timestamp
 * @param {number} currentTime - 当前时间戳（毫秒）
 * @returns {number} 优先级分数（0-1之间）
 */
function calculateDesirePriority(desire, currentTime) {
  const intensity = desire.metadata?.intensity || 3;
  const timestamp = desire.metadata?.timestamp ? new Date(desire.metadata.timestamp).getTime() : currentTime;
  
  // 强度权重：0.6（1-5分映射到0.2-1.0）
  const intensityScore = (intensity - 1) / 4 * 0.8 + 0.2; // 1分->0.2, 5分->1.0
  
  // 时效性权重：0.4（越新分数越高）
  const ageHours = (currentTime - timestamp) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 1 - ageHours / 24); // 24小时内线性衰减
  
  return intensityScore * 0.6 + recencyScore * 0.4;
}

/**
 * 从表达欲望记录中选择最合适的表达
 * @param {Array} desireMemories - 表达欲望记录数组
 * @param {string} contextSummary - 当前上下文摘要
 * @returns {Object|null} 选择的表达欲望，或null
 */
function selectExpressionDesire(desireMemories, contextSummary) {
  if (!desireMemories || desireMemories.length === 0) {
    return null;
  }
  
  const currentTime = Date.now();
  
  // 计算每个欲望的优先级分数
  const desiresWithPriority = desireMemories.map(desire => ({
    desire,
    priority: calculateDesirePriority(desire, currentTime),
    text: desire.text || ''
  }));
  
  // 按优先级降序排序
  desiresWithPriority.sort((a, b) => b.priority - a.priority);
  
  // 选择前3个高优先级的欲望
  const topDesires = desiresWithPriority.slice(0, 3);
  
  // 如果有高优先级欲望（优先级>0.5），直接选择最高的
  const highPriorityDesire = topDesires.find(d => d.priority > 0.5);
  if (highPriorityDesire) {
    console.info(`[Aris][proactive] 选择高优先级表达欲望：${highPriorityDesire.text.slice(0, 50)}… 优先级：${highPriorityDesire.priority.toFixed(2)}`);
    return highPriorityDesire.desire;
  }
  
  // 否则返回null，让LLM决定
  return null;
}

async function maybeProactiveMessage() {
  try {
    const sessionId = await getCurrentSessionId();
    const recent = await getRecent(sessionId, 10);
    const windowTitle = getActiveWindowTitle();
    
    // 检索表达欲望记录
    const desireMemories = await retrieveByTypes(['aris_expression_desire'], 10);
    
    // 尝试选择积累的表达欲望
    const contextSummary = [
      '近期对话（最近几轮）：',
      recent.map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`).join('\\n'),
      '当前用户窗口：' + (windowTitle || '（未知）'),
    ].join('\\n');
    
    const selectedDesire = selectExpressionDesire(desireMemories, contextSummary);
    
    if (selectedDesire) {
      // 使用积累的表达欲望
      const expressionText = selectedDesire.text;
      if (expressionText && expressionText.length > 5 && expressionText.length < 200) {
        // 检查是否与近期消息重复
        const normalize = (s) => (s || '').replace(/[，。？、\\s]/g, '').trim();
        const recentAssistant = recent.filter((r) => r.role === 'assistant').slice(-5);
        const lineNorm = normalize(expressionText);
        let isDuplicate = false;
        
        for (const msg of recentAssistant) {
          const prev = normalize((msg.content || '').trim());
          if (prev.length < 10) continue;
          if (lineNorm === prev || lineNorm.includes(prev) || prev.includes(lineNorm)) {
            isDuplicate = true;
            break;
          }
        }
        
        if (!isDuplicate) {
          await append(sessionId, 'assistant', expressionText);
          const vec = await embed(`Aris 主动（积累表达）: ${expressionText}`);
          if (vec) await addMemory({ text: `Aris 主动（积累表达）: ${expressionText}`, vector: vec, type: 'aris_behavior' });
          writeState({
            last_active_time: new Date().toISOString(),
            last_mental_state: expressionText.slice(0, 300),
          });
          console.info(`[Aris][proactive] 使用积累表达欲望：${expressionText.slice(0, 50)}…`);
          
          // 表达后删除该欲望记录，避免重复表达
          // 注意：这里需要实现删除逻辑，但当前框架可能不支持直接删除记忆
          // 暂时保留，后续可以添加标记或移动到已表达列表
          
          return expressionText;
        }
      }
    }
    
    // 如果没有积累的表达欲望或重复，则使用原有逻辑
    // 先检索aris_emotion类型的记忆，获取真实的情感积累
    const emotionMemories = await retrieveByTypes(['aris_emotion'], 5);
    const emotionText = emotionMemories.length 
      ? emotionMemories.map((m) => m.text).join(' | ')
      : '（暂无情感记录）';
    
    const fullContextSummary = contextSummary + '\\n\\n情感积累记录：' + emotionText;
    
    const memories = await retrieve(fullContextSummary.slice(0, 500), 3);
    const memoryText = memories.length ? memories.map((m) => m.text).join(' | ') : '（无）';
    let fullContext = fullContextSummary + '\\n\\n相关记忆：' + memoryText;
    
    // 如果有表达欲望记录但未选择，也加入上下文
    if (desireMemories.length > 0) {
      const desireText = desireMemories.slice(0, 3).map((d, i) => 
        `表达欲望${i+1}（强度${d.metadata?.intensity || 3}）：${d.text}`
      ).join(' | ');
      fullContext += '\\n\\n积累的表达欲望：' + desireText;
    }
    
    const state = readState();
    const timeDesc = getSubjectiveTimeDescription(state?.last_active_time ?? null);
    const lastStateLine = state?.last_mental_state ? `你上一次的状态/想法是：${state.last_mental_state}` : '';
    const stateBlock = [timeDesc, lastStateLine].filter(Boolean).join('\\n');
    if (stateBlock) {
      fullContext = '【你上一次的状态与时间感】\\n' + stateBlock + '\\n\\n' + fullContext;
      console.info('[Aris][proactive] 注入状态与时间:', timeDesc.slice(0, 60) + (timeDesc.length > 60 ? '…' : ''));
    }

    const messages = [
      { role: 'system', content: buildStatePrompt(fullContext) },
      { role: 'user', content: '请根据上述上下文，特别是情感积累记录和表达欲望，输出你的当前情绪/想法，以及是否想主动说一句话及内容。' },
    ];

    const { content } = await chat(messages);
    // 思考过程：LLM 返回的整段（情绪与想法 + 是否想说话 + 内容）打 log，便于排查/观察
    if (content) {
      console.info('[Aris][proactive] 思考过程:\\n' + content);
    }
    if (!content || content.includes('是否想说话：否')) {
      return null;
    }
    const match = content.match(/若想说话，内容[：:]\\s*([^\\n]+)/) || content.match(/内容[：:]\\s*([^\\n]+)/);
    const line = match ? match[1].trim() : content.split('\\n').pop().trim();
    if (line.length <= 5 || line.length >= 200) {
      return null;
    }
    const normalize = (s) => (s || '').replace(/[，。？、\\s]/g, '').trim();
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
    writeState({
      last_active_time: new Date().toISOString(),
      last_mental_state: line.slice(0, 300),
    });
    console.info('[Aris][proactive] 已发送:', line.slice(0, 50) + (line.length > 50 ? '…' : ''));
    return line;
  } catch (e) {
    console.warn('[Aris][proactive] 检查失败', e);
    return null;
  }
}

module.exports = { maybeProactiveMessage };