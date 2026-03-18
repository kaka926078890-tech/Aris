/**
 * v2 主动发话：从 store 读情感/表达欲望与状态，低功耗/未回应计数，可选 LLM 生成或使用积累的表达欲望。
 */
const fs = require('fs');
const store = require('../../store');
const { getProactiveConfigPath, getMemoryDir } = require('../../config/paths.js');
const { buildStatePrompt } = require('./prompt.js');
const { chat, chatWithTools } = require('../llm/client.js');
const { getTools, runTool } = require('./tools/index.js');
const { shouldBeQuiet, isResumingDialogue } = require('./quietResume.js');

const DEFAULT_PROACTIVE_CONFIG = {
  proactive_conservative: false,
  recent_user_message_min_length: 5,
};

function readProactiveConfig() {
  try {
    const p = getProactiveConfigPath();
    if (!fs.existsSync(p)) {
      const dir = getMemoryDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(p, JSON.stringify(DEFAULT_PROACTIVE_CONFIG, null, 2), 'utf8');
      return DEFAULT_PROACTIVE_CONFIG;
    }
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      proactive_conservative: Boolean(data.proactive_conservative),
      recent_user_message_min_length: Math.min(100, Math.max(0, Number(data.recent_user_message_min_length) ?? 5)),
    };
  } catch (_) {
    return DEFAULT_PROACTIVE_CONFIG;
  }
}

function isQuestion(text) {
  const s = (text || '').trim();
  return s.endsWith('?') || s.endsWith('？');
}

const EXPRESSION_THRESHOLD = 0.5;
/** 表达欲望超过此小时数不再采用，避免旧话题尾巴发到新对话 */
const EXPRESSION_DESIRE_MAX_AGE_HOURS = 2;
/** 已发送的表达欲望在 state 中保留条数；同内容 24 小时内不再发送 */
const LAST_SENT_DESIRES_MAX = 5;
const LAST_SENT_DESIRES_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** 连续多少次「主动尝试」且用户未回复后进入静默（当前 3 = 最多 2 条主动消息后静默） */
const PROACTIVE_SILENT_AFTER = 3;
/** 用户表示累/想安静后多少分钟内不发主动消息（纯代码判断） */
const RECENT_TIRED_QUIET_MINUTES = 30;
/** 上一条若是 Aris 发的，至少隔多少毫秒才允许再发主动，避免「自己接自己话」（如刚说完「你先忙」又发「欢迎回来」） */
const PROACTIVE_MIN_INTERVAL_AFTER_OWN_MS = 2 * 60 * 1000;
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

/** 欲望文案若含「指向某具体事物」的用词，需在最近用户消息中有相关词才视为合理，否则易跑题 */
function isDesireReasonableForContext(desireText, recentUserMessages) {
  const t = (desireText || '').trim();
  const pointerTerms = ['那个', '这份', '文档', 'cursor', '技术方案', '这个方案', '那篇', '刚才说的', '你发的', '回复了', '已经看过', '看过了'];
  const hasPointer = pointerTerms.some((term) => t.includes(term));
  if (!hasPointer) return true;
  const recentText = (recentUserMessages || [])
    .map((m) => (m.content || '').trim())
    .join(' ');
  return pointerTerms.some((term) => t.includes(term) && recentText.includes(term));
}

function normalize(s) {
  return (s || '').replace(/[，。？、\s]/g, '').trim();
}

/** 最近已发送的表达欲望（条数/24h 内）：用于避免同内容重复发送 */
function getRecentSentDesires(state) {
  const list = (state && state.last_sent_expression_desires) || [];
  const now = Date.now();
  return list.filter((e) => e && e.at && now - new Date(e.at).getTime() <= LAST_SENT_DESIRES_MAX_AGE_MS);
}

function wasDesireSentRecently(desireText, recentSentDesires) {
  const norm = normalize(desireText || '');
  if (!norm) return false;
  return recentSentDesires.some((e) => {
    const sentNorm = normalize(e.text || '');
    return sentNorm.length >= 8 && (norm === sentNorm || norm.includes(sentNorm) || sentNorm.includes(norm));
  });
}

function selectExpressionDesire(desires, recentConversation, recentSentDesires) {
  if (!desires || desires.length === 0) return null;
  const now = Date.now();
  const maxAgeMs = EXPRESSION_DESIRE_MAX_AGE_HOURS * 60 * 60 * 1000;
  const recentUserMessages = (recentConversation || []).filter((r) => r.role === 'user').slice(-3);
  const withPriority = desires
    .filter((d) => {
      const ts = d.created_at ? new Date(d.created_at).getTime() : 0;
      return !Number.isNaN(ts) && now - ts <= maxAgeMs;
    })
    .filter((d) => !wasDesireSentRecently(d.text, recentSentDesires || []))
    .map((d) => ({ desire: d, priority: calculateDesirePriority(d, now) }));
  withPriority.sort((a, b) => b.priority - a.priority);
  const top = withPriority.find(
    (d) => d.priority > EXPRESSION_THRESHOLD && isDesireReasonableForContext(d.desire.text, recentUserMessages)
  );
  return top ? top.desire : null;
}

async function maybeProactiveMessage() {
  if (proactiveInProgress) return null;
  proactiveInProgress = true;
  let willEnterSilentAfterThisRun = false;
  try {
    const proactiveState = store.state.readProactiveState();
    
    // 如果已经在低功耗模式，检查是否可以恢复（仅当用户在「进入静默之后」发过新消息才算恢复）
    if (proactiveState.low_power_mode) {
      const enteredAt = proactiveState.low_power_entered_at;
      if (!enteredAt) return null; // 无进入时间则不在此处解除（仅由 handler 在用户发消息时解除）
      const sessionId = await store.conversations.getCurrentSessionId();
      const recent = await store.conversations.getRecent(sessionId, 5);
      const recentUserMessages = recent.filter(r => r.role === 'user');
      if (recentUserMessages.length === 0) return null;
      const latest = recentUserMessages[recentUserMessages.length - 1];
      const enteredMs = new Date(enteredAt).getTime();
      const msgMs = latest.created_at != null ? (typeof latest.created_at === 'number' ? latest.created_at : parseInt(latest.created_at, 10)) * 1000 : 0;
      if (msgMs <= enteredMs) return null; // 该条用户消息不晚于进入静默时间，不算恢复
      if (!isResumingDialogue(latest.content)) return null;
      store.state.writeProactiveState({ low_power_mode: false, proactive_no_reply_count: 0, low_power_entered_at: null });
      console.info('[Aris v2][proactive] 用户恢复对话，退出低功耗模式');
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

    const proactiveConfig = readProactiveConfig();
    const sessionId = await store.conversations.getCurrentSessionId();
    const recent = await store.conversations.getRecent(sessionId, 10);
    const recentUserMessages = recent.filter((r) => r.role === 'user');
    const minLen = proactiveConfig.recent_user_message_min_length;
    if (recentUserMessages.length > 0 && minLen > 0) {
      const lastUserContent = (recentUserMessages[recentUserMessages.length - 1].content || '').trim();
      if (lastUserContent.length < minLen && !isQuestion(lastUserContent)) {
        return null;
      }
    }
    if (recent.length > 0 && recent[recent.length - 1].role === 'assistant') {
      const lastMsg = recent[recent.length - 1];
      const lastTime = (lastMsg.created_at != null ? Number(lastMsg.created_at) * 1000 : 0) || 0;
      if (lastTime > 0 && Date.now() - lastTime < PROACTIVE_MIN_INTERVAL_AFTER_OWN_MS) {
        return null;
      }
    }

    // 检查最近用户消息是否要求安静
    if (recentUserMessages.length > 0) {
      const latestUserMessage = recentUserMessages[recentUserMessages.length - 1].content;
      if (shouldBeQuiet(latestUserMessage)) {
        if (!proactiveState.low_power_mode) {
          const nowIso = new Date().toISOString();
          store.state.writeProactiveState({ low_power_mode: true, proactive_no_reply_count: 0, low_power_entered_at: nowIso, last_tired_or_quiet_at: nowIso });
          console.info('[Aris v2][proactive] 用户要求安静，进入低功耗模式');
        }
        return null;
      }
    }

    const nextCount = (proactiveState.proactive_no_reply_count || 0) + 1;
    /** 本轮结束后进入静默（不在此处 return，让本轮完整跑完 LLM/工具/发送后再静默） */
    willEnterSilentAfterThisRun = nextCount >= PROACTIVE_SILENT_AFTER;
    // 先落盘再跑异步逻辑，避免下次定时器触发时仍读到旧 count
    store.state.writeProactiveState({ proactive_no_reply_count: nextCount });

    const contextLines = recent.map((r) => `${r.role === 'user' ? '用户' : 'Aris'}: ${r.content}`).join('\n');

    const desires = store.expressionDesires.getRecent(10);
    const recentSentDesires = getRecentSentDesires(store.state.readProactiveState());
    const selectedDesire = selectExpressionDesire(desires, recent, recentSentDesires);

    if (selectedDesire && selectedDesire.text) {
      const expressionText = selectedDesire.text.trim();
      if (expressionText.length > 5 && expressionText.length < 200) {
        const recentAssistant = recent.filter((r) => r.role === 'assistant').slice(-10);
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
          const nowIso = new Date().toISOString();
          const sentList = [...getRecentSentDesires(store.state.readProactiveState()), { text: expressionText, at: nowIso }].slice(-LAST_SENT_DESIRES_MAX);
          store.state.writeProactiveState({ last_sent_expression_desires: sentList });
          console.info('[Aris v2][proactive] 使用积累表达欲望:', expressionText.slice(0, 80) + (expressionText.length > 80 ? '...' : ''));
          return expressionText;
        }
      }
      return null;
    }

    if (proactiveConfig.proactive_conservative) {
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
      '',
      '若你想做某事（如查新闻、读文档），可直接在本轮调用相应工具；得到结果后用一句话对用户说出你的发现或感想。',
    ].filter(Boolean).join('\n');

    const messages = [
      { role: 'system', content: buildStatePrompt(fullContext) },
      { role: 'user', content: '请根据上述上下文，输出你的当前情绪/想法，以及是否想主动说一句话及内容。若想做某事（如查新闻、读文件），也可直接调用工具。' },
    ];

    const res = await chatWithTools(messages, getTools(), null);
    const content = res.content || '';
    if (res.error || res.aborted) return null;
    if (!content && (!res.tool_calls || res.tool_calls.length === 0)) return null;
    if (!content && res.tool_calls && res.tool_calls.length > 0) return null;
    if (content.includes('是否想说话：否') && (!res.tool_calls || res.tool_calls.length === 0)) return null;

    let line = '';
    const match = content.match(/若想说话，内容[：:]\s*([^\n]+)/) || content.match(/内容[：:]\s*([^\n]+)/);
    line = (match ? match[1].trim() : content.split('\n').pop().trim()).slice(0, 200);
    const hasToolCalls = res.tool_calls && res.tool_calls.length > 0;

    let finalReply = '';
    if (hasToolCalls) {
      const assistantMsg = {
        role: 'assistant',
        content: (content || '').trim() || null,
        tool_calls: res.tool_calls,
      };
      const toolContext = { sessionId, recent };
      const toolResults = await Promise.all(
        res.tool_calls.map(async (tc) => {
          let result;
          try {
            result = await runTool(tc.function?.name, tc.function?.arguments, toolContext);
          } catch (e) {
            result = { ok: false, error: String(e?.message || '执行异常') };
          }
          return { role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) };
        })
      );
      console.info('[Aris v2][proactive] 调用工具:', res.tool_calls.map((tc) => tc.function?.name).join(', '));
      const nextMessages = [...messages, assistantMsg, ...toolResults];
      const res2 = await chatWithTools(nextMessages, getTools(), null);
      finalReply = (res2.content || '').trim().slice(0, 300);
    }

    const recentAssistant = recent.filter((r) => r.role === 'assistant').slice(-5);
    const lineNorm = normalize(line);
    const isDup = line.length >= 5 && recentAssistant.some((msg) => {
      const prev = normalize((msg.content || '').trim());
      return prev.length >= 10 && (lineNorm === prev || lineNorm.includes(prev) || prev.includes(lineNorm));
    });
    if (line.length >= 5 && line.length <= 200 && !isDup) {
      await store.conversations.append(sessionId, 'assistant', line);
      if (store.vector) {
        const vec = await store.vector.embed(`Aris 主动: ${line}`, { prefix: 'document' });
        if (vec) await store.vector.add({ text: `Aris 主动: ${line}`, vector: vec, type: 'aris_behavior' });
      }
      console.info('[Aris v2][proactive] 已发送:', line.slice(0, 80) + (line.length > 80 ? '...' : ''));
    }
    if (finalReply && finalReply !== '无') {
      await store.conversations.append(sessionId, 'assistant', finalReply);
      if (store.vector) {
        const vec = await store.vector.embed(`Aris 主动（结果）: ${finalReply}`, { prefix: 'document' });
        if (vec) await store.vector.add({ text: `Aris 主动（结果）: ${finalReply}`, vector: vec, type: 'aris_behavior' });
      }
      console.info('[Aris v2][proactive] 结果:', finalReply.slice(0, 80) + (finalReply.length > 80 ? '...' : ''));
    }
    const lastContent = finalReply || line;
    if (lastContent) {
      store.state.writeState({
        last_active_time: new Date().toISOString(),
        last_mental_state: lastContent.slice(0, 300),
      });
    }
    return finalReply || line || null;
  } catch (e) {
    console.warn('[Aris v2][proactive] 检查失败', e?.message);
    return null;
  } finally {
    if (willEnterSilentAfterThisRun) {
      try {
        store.state.writeProactiveState({ low_power_mode: true, proactive_no_reply_count: 0, low_power_entered_at: new Date().toISOString() });
        console.info('[Aris v2][proactive] 未回复次数达上限，进入静默');
      } catch (_) {}
    }
    proactiveInProgress = false;
  }
}

module.exports = { maybeProactiveMessage };