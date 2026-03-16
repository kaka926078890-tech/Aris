/**
 * v2 主动发话：从 store 读情感/表达欲望与状态，低功耗/未回应计数，可选 LLM 生成或使用积累的表达欲望。
 */
const store = require('../../store');
const { buildStatePrompt } = require('./prompt.js');
const { chat } = require('../llm/client.js');
const { shouldBeQuiet, isResumingDialogue } = require('./quietResume.js');

const EXPRESSION_THRESHOLD = 0.5;
/** 连续多少次「主动尝试」且用户未回复后进入静默（当前 3 = 最多 2 条主动消息后静默） */
const PROACTIVE_SILENT_AFTER = 3;
/** 用户表示累/想安静后多少分钟内不发主动消息（纯代码判断） */
const RECENT_TIRED_QUIET_MINUTES = 30;
/** 防止定时器重叠导致多次读到同一 count 的锁 */
let proactiveInProgress = false;

function getSubjectiveTimeDescription(lastActiveTimeIso) {
  const now = new Date();
  const nowStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (!lastActiveTimeIso) return `现在是 ${nowStr}。（暂无记录）`;
  let last;
  try {
    last = new Date(lastActiveTimeIso);
    if (Number.isNaN(last.getTime())) last = null;
  } catch (_) {
    last = null;
  }
  if (!last) return `现在是 ${nowStr}。`;
  const deltaMin = Math.floor((now.getTime() - last.getTime()) / 60000);
  return `现在是 ${nowStr}。距离上次活跃已过去 ${deltaMin} 分钟。`;
}

function calculateDesirePriority(desire, currentTime) {
  const intensity = desire.intensity ?? 3;
  const ts = desire.created_at ? new Date(desire.created_at).getTime() : currentTime;
  const intensityScore = ((intensity - 1) / 4) * 0.8 + 0.2;
  const ageHours = (currentTime - ts) / (1000 * 60 * 60);
  const recencyScore = Math.max(0, 1 - ageHours / 24);
  return intensityScore * 0.6 + recencyScore * 0.4;
}

function selectExpressionDesire(desires) {
  if (!desires || desires.length === 0) return null;
  const now = Date.now();
  const withPriority = desires.map((d) => ({ desire: d, priority: calculateDesirePriority(d, now) }));
  withPriority.sort((a, b) => b.priority - a.priority);
  const top = withPriority.find((d) => d.priority > EXPRESSION_THRESHOLD);
  return top ? top.desire : null;
}

function normalize(s) {
  return (s || '').replace(/[，。？、\s]/g, '').trim();
}

async function maybeProactiveMessage() {
  if (proactiveInProgress) return null;
  proactiveInProgress = true;
  try {
    const proactiveState = store.state.readProactiveState();
    
    // 如果已经在低功耗模式，检查是否可以恢复
    if (proactiveState.low_power_mode) {
      const sessionId = await store.conversations.getCurrentSessionId();
      const recent = await store.conversations.getRecent(sessionId, 5);
      
      // 检查最近是否有用户消息
      const recentUserMessages = recent.filter(r => r.role === 'user');
      if (recentUserMessages.length > 0) {
        const latestUserMessage = recentUserMessages[recentUserMessages.length - 1].content;
        // 如果用户是在恢复对话，就退出低功耗模式
        if (isResumingDialogue(latestUserMessage)) {
          store.state.writeProactiveState({ low_power_mode: false, proactive_no_reply_count: 0 });
          console.info('[Aris v2][proactive] 用户恢复对话，退出低功耗模式');
        }
      } else {
        return null;
      }
    }

    // 若仍在低功耗（用户未恢复对话），不发任何主动消息
    const stateNow = store.state.readProactiveState();
    if (stateNow.low_power_mode) return null;

    // 用户近期表示累/想安静：在 N 分钟内不发主动（由代码决定，不交给 prompt）
    const lastTired = stateNow.last_tired_or_quiet_at;
    if (lastTired) {
      try {
        const t = new Date(lastTired).getTime();
        if (!Number.isNaN(t) && (Date.now() - t) / 60000 < RECENT_TIRED_QUIET_MINUTES) {
          return null;
        }
      } catch (_) {}
    }

    const sessionId = await store.conversations.getCurrentSessionId();
    const recent = await store.conversations.getRecent(sessionId, 10);
    
    // 检查最近用户消息是否要求安静
    const recentUserMessages = recent.filter(r => r.role === 'user');
    if (recentUserMessages.length > 0) {
      const latestUserMessage = recentUserMessages[recentUserMessages.length - 1].content;
      if (shouldBeQuiet(latestUserMessage)) {
        if (!proactiveState.low_power_mode) {
          store.state.writeProactiveState({ low_power_mode: true, proactive_no_reply_count: 0, last_tired_or_quiet_at: new Date().toISOString() });
          console.info('[Aris v2][proactive] 用户要求安静，进入低功耗模式');
        }
        return null;
      }
    }

    const nextCount = (proactiveState.proactive_no_reply_count || 0) + 1;
    if (nextCount >= PROACTIVE_SILENT_AFTER) {
      store.state.writeProactiveState({ low_power_mode: true, proactive_no_reply_count: 0 });
      console.info('[Aris v2][proactive] 未回复次数达上限，进入静默');
      return null;
    }
    // 先落盘再跑异步逻辑，避免下次定时器触发时仍读到旧 count
    store.state.writeProactiveState({ proactive_no_reply_count: nextCount });

    const contextLines = recent.map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`).join('\n');

    const desires = store.expressionDesires.getRecent(10);
    const selectedDesire = selectExpressionDesire(desires);

    if (selectedDesire && selectedDesire.text) {
      const expressionText = selectedDesire.text.trim();
      if (expressionText.length > 5 && expressionText.length < 200) {
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
          await store.conversations.append(sessionId, 'assistant', expressionText);
          if (store.vector) {
            const vec = await store.vector.embed(`Aris 主动（积累表达）: ${expressionText}`, { prefix: 'document' });
            if (vec) await store.vector.add({ text: `Aris 主动（积累表达）: ${expressionText}`, vector: vec, type: 'aris_behavior' });
          }
          store.state.writeState({
            last_active_time: new Date().toISOString(),
            last_mental_state: expressionText.slice(0, 300),
          });
          console.info('[Aris v2][proactive] 使用积累表达欲望');
          return expressionText;
        }
      }
      return null;
    }

    const emotions = store.emotions.getRecent(10);
    const emotionContext = emotions.length
      ? emotions.slice(-3).map((e) => `（强度${e.intensity}）${e.text}`).join(' | ')
      : '（暂无情感记录）';

    const state = store.state.readState();
    const timeDesc = getSubjectiveTimeDescription(state?.last_active_time ?? null);
    const lastStateLine = state?.last_mental_state ? `你上一次的状态/想法是：${state.last_mental_state}` : '';
    const fullContext = [
      '【你上一次的状态与时间感】',
      timeDesc,
      lastStateLine,
      '',
      '【近期对话】',
      contextLines,
      '',
      '【情感记录】',
      emotionContext,
      '',
      '（需要用户喜好如游戏、休息偏好时可调用 get_preferences。）',
    ].filter(Boolean).join('\n');

    const messages = [
      { role: 'system', content: buildStatePrompt(fullContext) },
      { role: 'user', content: '请根据上述上下文，输出你的当前情绪/想法，以及是否想主动说一句话及内容。' },
    ];

    const { content } = await chat(messages);
    if (!content || content.includes('是否想说话：否')) return null;

    const match = content.match(/若想说话，内容[：:]\s*([^\n]+)/) || content.match(/内容[：:]\s*([^\n]+)/);
    const line = (match ? match[1].trim() : content.split('\n').pop().trim()).slice(0, 200);
    if (line.length <= 5 || line.length >= 200) return null;

    const recentAssistant = recent.filter((r) => r.role === 'assistant').slice(-5);
    const lineNorm = normalize(line);
    for (const msg of recentAssistant) {
      const prev = normalize((msg.content || '').trim());
      if (prev.length < 10) continue;
      if (lineNorm === prev || lineNorm.includes(prev) || prev.includes(lineNorm)) {
        return null;
      }
    }

    await store.conversations.append(sessionId, 'assistant', line);
    if (store.vector) {
      const vec = await store.vector.embed(`Aris 主动: ${line}`, { prefix: 'document' });
      if (vec) await store.vector.add({ text: `Aris 主动: ${line}`, vector: vec, type: 'aris_behavior' });
    }
    store.state.writeState({
      last_active_time: new Date().toISOString(),
      last_mental_state: line.slice(0, 300),
    });
    console.info('[Aris v2][proactive] 已发送');
    return line;
  } catch (e) {
    console.warn('[Aris v2][proactive] 检查失败', e?.message);
    return null;
  } finally {
    proactiveInProgress = false;
  }
}

module.exports = { maybeProactiveMessage };