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
const { addMemory, deleteMemoryById } = require('../memory/lancedb.js');
const { embed } = require('../memory/embedding.js');
const { readState, writeState, getSubjectiveTimeDescription, readProactiveState, writeProactiveState } = require('../context/arisState.js');
const { runSelfUpgrade } = require('./selfUpgrade.js');

/** 表达阈值：优先级超过此值时才使用积累的表达欲望直接表达，否则走 LLM */
const EXPRESSION_THRESHOLD = 0.5;

/**
 * 计算欲望与当前上下文的相关性（词/片段重叠，0-1）
 * 支持英文分词与中文 2 字片段，无重叠时返回 0.5 中性分
 */
function computeRelevanceScore(desireText, contextSummary) {
  if (!desireText || !contextSummary) return 0.5;
  const ctx = (contextSummary || '').toLowerCase();
  const tokenize = (s) => (s || '')
    .replace(/[\s，。！？、；：""''（）\n]+/g, ' ')
    .split(' ')
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  const desireTokens = tokenize(desireText);
  if (desireTokens.length > 0) {
    let hit = 0;
    for (const tok of desireTokens) {
      if (ctx.includes(tok.toLowerCase())) hit++;
    }
    const ratio = hit / desireTokens.length;
    return 0.5 + 0.5 * Math.min(1, ratio);
  }
  // 中文等无空格：用 2 字片段与上下文重叠
  const s = desireText.trim();
  if (s.length < 2) return 0.5;
  let chunks = 0;
  let hits = 0;
  for (let i = 0; i <= s.length - 2; i++) {
    chunks++;
    if (ctx.includes(s.slice(i, i + 2))) hits++;
  }
  if (chunks === 0) return 0.5;
  const ratio = hits / chunks;
  return 0.5 + 0.5 * Math.min(1, ratio);
}

/**
 * 计算表达欲望的优先级分数（阶段二：时效性 + 情感强度 + 相关性）
 * @param {Object} desire - 表达欲望记录，含 metadata.intensity、metadata.timestamp、text
 * @param {number} currentTime - 当前时间戳（毫秒）
 * @param {string} contextSummary - 当前上下文摘要，用于相关性
 * @returns {number} 优先级分数（0-1之间）
 */
function calculateDesirePriority(desire, currentTime, contextSummary) {
  const intensity = desire.metadata?.intensity || 3;
  const timestamp = desire.metadata?.timestamp ? new Date(desire.metadata.timestamp).getTime() : currentTime;
  const desireText = desire.text || '';

  // 情感强度（1-5 映射到 0.2-1.0），权重 0.5
  const intensityScore = (intensity - 1) / 4 * 0.8 + 0.2;
  // 时效性（越新越高），24 小时内线性衰减，权重 0.3
  const ageHours = (currentTime - timestamp) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 1 - ageHours / 24);
  // 与当前上下文相关性，权重 0.2
  const relevanceScore = computeRelevanceScore(desireText, contextSummary);

  return intensityScore * 0.5 + recencyScore * 0.3 + relevanceScore * 0.2;
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

  // 计算每个欲望的优先级分数（含相关性）
  const desiresWithPriority = desireMemories.map((desire) => ({
    desire,
    priority: calculateDesirePriority(desire, currentTime, contextSummary),
    text: desire.text || '',
  }));

  // 按优先级降序排序
  desiresWithPriority.sort((a, b) => b.priority - a.priority);

  // 取前若干条，按表达阈值决定是否直接表达
  const topDesires = desiresWithPriority.slice(0, 5);
  const highPriorityDesire = topDesires.find((d) => d.priority > EXPRESSION_THRESHOLD);
  if (highPriorityDesire) {
    console.info(`[Aris][proactive] 选择高优先级表达欲望（阈值=${EXPRESSION_THRESHOLD}）：${highPriorityDesire.text.slice(0, 50)}… 优先级：${highPriorityDesire.priority.toFixed(2)}`);
    return highPriorityDesire.desire;
  }

  // 否则返回 null，走 LLM 生成
  return null;
}

/**
 * 主动消息：定时每 3 分钟跑一次。会多轮调 API（表达欲望优先 / LLM 思考），
 * 只有通过「去重、长度、自升级前不发送」等检查的那条才会 append 并 IPC 到页面，其余仅打 log。
 * 规则：没发送的（去重、长度等原因）也累加「未回应」计数，避免十几轮都凑不到 1 条发送、一直烧 token。
 */
async function maybeProactiveMessage() {
  try {
    const proactiveState = readProactiveState();
    if (proactiveState.low_power_mode) {
      return null;
    }
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
          const p = readProactiveState();
          // 在发送之前先计算「若发送则计数器」；三次不回应才升级：nextCount===4 时先自升级、不发送；仅升级时进入低功耗
          const nextCount = p.proactive_no_reply_count + 1;
          if (nextCount >= 4 && !p.self_upgrade_done_today) {
            await runSelfUpgrade();
            writeProactiveState({ self_upgrade_done_today: true, low_power_mode: true, proactive_no_reply_count: 0 });
            return null;
          }
          await append(sessionId, 'assistant', expressionText);
          const vec = await embed(`Aris 主动（积累表达）: ${expressionText}`);
          if (vec) await addMemory({ text: `Aris 主动（积累表达）: ${expressionText}`, vector: vec, type: 'aris_behavior' });
          writeState({
            last_active_time: new Date().toISOString(),
            last_mental_state: expressionText.slice(0, 300),
          });
          writeProactiveState({ proactive_no_reply_count: Math.min(3, nextCount), low_power_mode: false });
          console.info(`[Aris][proactive] 使用积累表达欲望：${expressionText.slice(0, 50)}…`);
          if (selectedDesire.id != null) {
            await deleteMemoryById(selectedDesire.id);
          }
          return expressionText;
        }
        // 表达欲望与近期重复：没发送也累加计数，避免十几轮才凑满自升级
        const pDup = readProactiveState();
        const nextCountDup = pDup.proactive_no_reply_count + 1;
        if (nextCountDup >= 4 && !pDup.self_upgrade_done_today) {
          await runSelfUpgrade();
          writeProactiveState({ self_upgrade_done_today: true, low_power_mode: true, proactive_no_reply_count: 0 });
          return null;
        }
        writeProactiveState({ proactive_no_reply_count: Math.min(3, nextCountDup), low_power_mode: false });
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
      const pLine = readProactiveState();
      const nextCount = pLine.proactive_no_reply_count + 1;
      if (nextCount >= 4 && !pLine.self_upgrade_done_today) {
        await runSelfUpgrade();
        writeProactiveState({ self_upgrade_done_today: true, low_power_mode: true, proactive_no_reply_count: 0 });
        return null;
      }
      writeProactiveState({ proactive_no_reply_count: Math.min(3, nextCount), low_power_mode: false });
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
        const pLine = readProactiveState();
        const nextCount = pLine.proactive_no_reply_count + 1;
        if (nextCount >= 4 && !pLine.self_upgrade_done_today) {
          await runSelfUpgrade();
          writeProactiveState({ self_upgrade_done_today: true, low_power_mode: true, proactive_no_reply_count: 0 });
          return null;
        }
        writeProactiveState({ proactive_no_reply_count: Math.min(3, nextCount), low_power_mode: false });
        return null;
      }
    }
    const pLine = readProactiveState();
    // 在发送之前先计算「若发送则计数器」；三次不回应才升级：nextCount===4 时先自升级、不发送；仅升级时进入低功耗
    const nextCount = pLine.proactive_no_reply_count + 1;
    if (nextCount >= 4 && !pLine.self_upgrade_done_today) {
      await runSelfUpgrade();
      writeProactiveState({ self_upgrade_done_today: true, low_power_mode: true, proactive_no_reply_count: 0 });
      return null;
    }
    await append(sessionId, 'assistant', line);
    const vec = await embed(`Aris 主动: ${line}`);
    if (vec) await addMemory({ text: `Aris 主动: ${line}`, vector: vec, type: 'aris_behavior' });
    writeState({
      last_active_time: new Date().toISOString(),
      last_mental_state: line.slice(0, 300),
    });
    writeProactiveState({ proactive_no_reply_count: Math.min(3, nextCount), low_power_mode: false });
    console.info('[Aris][proactive] 已发送:', line.slice(0, 50) + (line.length > 50 ? '…' : ''));
    return line;
  } catch (e) {
    console.warn('[Aris][proactive] 检查失败', e);
    return null;
  }
}

module.exports = { maybeProactiveMessage };