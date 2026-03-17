/**
 * v2 对话 handler：方案 A prompt，工具循环，仅通过工具写入记录，禁止解析用户/助手文本。
 */
const store = require('../../store');
const config = require('../../config');
const { buildSystemPrompt, readBehaviorConfig } = require('./prompt.js');
const { getRelatedAssociationsLines, getCurrentRelatedEntityIds } = require('./associationContext.js');
const { maybeGenerateSummary } = require('./summaryGeneration.js');
const { getTools, runTool } = require('./tools/index.js');
const { chatWithTools } = require('../llm/client.js');
const { chatStream } = require('../llm/stream.js');
const { DIALOGUE_CHUNK_PREV_ROUNDS } = require('../../config/constants.js');
const { shouldBeQuiet, isResumingDialogue } = require('./quietResume.js');
const { getImportantDocReminder } = require('./importantDocsReminder.js');

const RECENT_ROUNDS = 3;

function formatMessageTime(created_at) {
  if (created_at == null) return '';
  const date = new Date(typeof created_at === 'number' ? created_at * 1000 : created_at);
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

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

/** 轻量情境标签：根据最近用户消息与 recent_mood_or_scene 生成一句 10 字内提示，供 context_aware_tone 注入 */
function getContextTagLine(recent, proactiveState) {
  const lastUser = recent.filter((r) => r.role === 'user').pop();
  const text = ((lastUser && lastUser.content) || '').trim() + ' ' + ((proactiveState && proactiveState.recent_mood_or_scene) || '');
  const lower = text.toLowerCase();
  if (/累|困|想静静|安静|别打扰|休息|歇会/.test(lower)) return '当前情境：用户可能想休息或安静。';
  if (/游戏|炉石|lol|杀戮尖塔|打一把|开黑/.test(lower)) return '当前话题偏游戏，可更轻松。';
  if (/谢谢|感谢|开心|不错/.test(lower)) return '当前情境：日常/轻松。';
  return '';
}

/** 最近一条情感记录，一句内（约 40 字） */
function getRecentEmotionLine() {
  const list = store.emotions.getRecent(1);
  if (!list.length) return '';
  const e = list[0];
  const text = (e.text || '').trim().slice(0, 25);
  const intensity = e.intensity != null ? e.intensity : 3;
  return text ? `你最近记录的情感（强度${intensity}）：${text}。` : '';
}

/** 最近用户纠错摘要，一句内（约 50 字） */
function getCorrectionsSummaryLine() {
  const list = store.corrections.getRecent(3);
  if (!list.length) return '';
  const parts = list.slice(-2).map((t) => {
    const m = (t || '').match(/用户纠正[：:]\s*([^\n]+)/);
    return m ? m[1].trim().slice(0, 18) : '';
  });
  const raw = parts.filter(Boolean).join('、');
  const line = raw.slice(0, 50);
  return line ? `用户曾纠正：${line}。` : '';
}

async function buildPromptContext(sessionId, recent) {
  const id = store.identity.readIdentity();
  const userIdentity = id.name ? `用户名字：${id.name}` + (id.notes ? '\n' + id.notes : '') : '（无）';
  const userRequirements = store.requirements.getSummary() || '（无）';
  const contextWindow = recent
    .map((r) => {
      const who = r.role === 'user' ? '用户' : 'Aris';
      const timeLabel = formatMessageTime(r.created_at) ? ` (${formatMessageTime(r.created_at)}) ` : ' ';
      return `${who}${timeLabel}: ${r.content}`;
    })
    .join('\n');
  const state = store.state.readState();
  const timeDesc = getSubjectiveTimeDescription(state?.last_active_time ?? null);
  const lastStateLine = state?.last_mental_state ? `你上一次的状态/想法是：${state.last_mental_state}` : '';
  const lastStateAndSubjectiveTime = [timeDesc, lastStateLine].filter(Boolean).join('\n') || '（无）';
  const relatedAssociations = await getRelatedAssociationsLines(sessionId, recent);
  const recentSummaryEntry = store.summaries?.readSummary(sessionId);
  const recentSummary = recentSummaryEntry?.content?.trim() || '（无）';
  let systemPrompt = buildSystemPrompt({
    userIdentity,
    userRequirements,
    contextWindow,
    lastStateAndSubjectiveTime,
    relatedAssociations,
    recentSummary,
  });
  const isSessionFirstMessage = recent.length === 1 && recent[0].role === 'user';
  const reminderLine = getImportantDocReminder(isSessionFirstMessage);
  if (reminderLine) systemPrompt = systemPrompt + '\n\n' + reminderLine;
  const behavior = readBehaviorConfig();
  if (behavior.context_aware_tone) {
    const proactiveState = store.state.readProactiveState();
    const contextLine = getContextTagLine(recent, proactiveState);
    if (contextLine) systemPrompt = systemPrompt + '\n' + contextLine;
  }
  if (behavior.inject_corrections_summary) {
    const correctionsLine = getCorrectionsSummaryLine();
    if (correctionsLine) systemPrompt = systemPrompt + '\n' + correctionsLine;
  }
  if (behavior.inject_recent_emotion) {
    const emotionLine = getRecentEmotionLine();
    if (emotionLine) systemPrompt = systemPrompt + '\n' + emotionLine;
  }
  if (behavior.expression_style) {
    const styleMap = { warm: '温暖', casual: '随意自然', concise: '简洁' };
    const label = styleMap[behavior.expression_style] || behavior.expression_style;
    systemPrompt = systemPrompt + '\n当前表达风格倾向：' + label + '。';
  }
  const recentMessages = recent.slice(-(RECENT_ROUNDS * 2));
  return {
    systemPrompt,
    messages: [
      { role: 'system', content: systemPrompt },
      ...recentMessages.map((r) => ({ role: r.role, content: r.content })),
    ],
  };
}

function filterReplyForDisplay(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

/** 检测是否为 DSML/工具标记类内容，避免写回对话导致模型继续输出或卡住 */
function isDsmlOrToolMarkup(content) {
  if (typeof content !== 'string' || !content.trim()) return false;
  const s = content.trim();
  return (s.includes('DSML') && (s.includes('<') || s.includes('>'))) || (s.includes('function_calls') && s.includes('invoke'));
}

/** 若为 DSML/标记则不再作为助手正文写回，避免下一轮/流式继续输出 */
function sanitizeAssistantContent(content) {
  if (content == null || content === '') return null;
  const str = String(content).trim();
  if (!str) return null;
  if (isDsmlOrToolMarkup(str)) return null;
  return str;
}

async function handleUserMessage(userContent, sendChunk, sendAgentActions, signal) {
  if (signal && signal.aborted) {
    const sessionId = await store.conversations.getCurrentSessionId();
    return { content: '', error: true, sessionId, aborted: true };
  }
  const sessionId = await store.conversations.getCurrentSessionId();
  
  // 检查用户是否要求安静
  if (shouldBeQuiet(userContent)) {
    store.state.writeProactiveState({ low_power_mode: true, proactive_no_reply_count: 0, last_tired_or_quiet_at: new Date().toISOString() });
    console.info('[Aris v2] 用户要求安静，立即进入低功耗模式');
  } else {
    // 检查当前是否在低功耗模式
    const proactiveState = store.state.readProactiveState();
    if (proactiveState.low_power_mode) {
      // 如果在低功耗模式，检查用户是否在恢复对话
      if (isResumingDialogue(userContent)) {
        store.state.writeProactiveState({ low_power_mode: false, proactive_no_reply_count: 0, low_power_entered_at: null });
        console.info('[Aris v2] 用户恢复对话，退出低功耗模式');
      }
    } else {
      // 正常模式，重置计数器
      store.state.writeProactiveState({ proactive_no_reply_count: 0, low_power_mode: false, low_power_entered_at: null });
    }
  }

  await store.conversations.append(sessionId, 'user', userContent);
  store.state.writeProactiveState({ last_user_engaged_at: new Date().toISOString() });
  const userPreview = (typeof userContent === 'string' && userContent.length > 0)
    ? (userContent.length <= 120 ? userContent.trim() : userContent.trim().slice(0, 120) + '…')
    : '(空)';
  console.info('[Aris v2] 用户消息:', userPreview);

  const recent = await store.conversations.getRecent(sessionId, RECENT_ROUNDS * 2 + 2);
  const { messages } = await buildPromptContext(sessionId, recent);
  const sysLen = (messages[0] && messages[0].content) ? String(messages[0].content).length : 0;
  console.info('[Aris v2] 本轮 prompt: system 约', sysLen, '字, 消息数', messages.length);

  let currentMessages = messages;
  let reply = '';
  let err = false;
  let hadToolCalls = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let hasOfficialUsage = false;
  const MAX_TOOL_ROUNDS = 20;
  const allAgentActions = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal && signal.aborted) break;
    const res = await chatWithTools(currentMessages, getTools(), signal);
    if (res.aborted) break;
    reply = res.content || '';
    err = res.error;
    if (res.usage) {
      totalInputTokens += Number(res.usage.prompt_tokens) || 0;
      totalOutputTokens += Number(res.usage.completion_tokens) || 0;
      hasOfficialUsage = true;
    }
    if (!res.tool_calls || res.tool_calls.length === 0) break;

    hadToolCalls = true;
    const assistantContent = sanitizeAssistantContent(res.content);
    const assistantMsg = {
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: res.tool_calls,
    };
    const toolContext = { sessionId, recent };
    const toolResults = await Promise.all(
      res.tool_calls.map(async (tc) => {
        const name = tc.function?.name;
        const args = tc.function?.arguments;
        let result;
        try {
          result = await runTool(name, args, toolContext);
        } catch (e) {
          console.warn('[Aris v2] runTool error', name, e?.message);
          result = { ok: false, error: String(e?.message || '执行异常') };
        }
        return {
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        };
      })
    );
    const toolSummary = res.tool_calls.map((tc, i) => {
      const r = toolResults[i];
      let ok = true;
      try {
        if (r && r.content) {
          const parsed = JSON.parse(r.content);
          ok = parsed && parsed.ok !== false;
        }
      } catch (_) { ok = false; }
      return (tc.function?.name || '?') + '=' + (ok ? 'ok' : 'err');
    }).join(', ');
    console.info('[Aris v2] 工具执行结果:', toolSummary);
    const batch = res.tool_calls.map((tc, i) => ({
      name: tc.function?.name,
      args: tc.function?.arguments,
      result: toolResults[i]?.content,
    }));
    allAgentActions.push(batch);
    if (typeof sendAgentActions === 'function') {
      sendAgentActions(allAgentActions);
    }
    currentMessages = [...currentMessages, assistantMsg, ...toolResults];
  }

  if (signal && signal.aborted) {
    await store.conversations.append(sessionId, 'assistant', reply || '[已停止]');
    return { content: reply || '', error: false, sessionId, aborted: true };
  }

  // 有工具调用时：若本轮已有可用正文，直接用它并流式输出；仅当无正文或为 DSML/工具标记时才再调 chatStream 要一句总结
  if (hadToolCalls && currentMessages.length > 0) {
    const hasUsableReply = reply && String(reply).trim() && !isDsmlOrToolMarkup(reply);
    if (hasUsableReply) {
      if (sendChunk) {
        const contentForStream = filterReplyForDisplay(reply);
        for (let i = 0; i < contentForStream.length; i += 2) {
          if (signal && signal.aborted) break;
          sendChunk(contentForStream.slice(i, i + 2));
          await new Promise((r) => setTimeout(r, 16));
        }
      }
    } else {
      try {
        console.info('[Aris v2] 工具调用结束且无正文，流式生成一句总结…');
        const messagesForSummary = [
          ...currentMessages,
          {
            role: 'user',
            content: '请用一两句自然语言总结你刚才做了什么或接下来打算做什么，不要输出任何 DSML、XML 或工具调用，只回复纯文本。',
          },
        ];
        const streamRes = await chatStream(messagesForSummary, () => {}, signal);
        const fullContent = streamRes.content || '';
        reply = fullContent;
        if (streamRes.usage) {
          totalInputTokens += Number(streamRes.usage.prompt_tokens) || 0;
          totalOutputTokens += Number(streamRes.usage.completion_tokens) || 0;
          hasOfficialUsage = true;
        }
        if (isDsmlOrToolMarkup(fullContent)) {
          if (sendChunk) sendChunk('（上轮为工具调用，未生成自然语言回复，可继续发消息）');
          reply = '';
        } else if (sendChunk && fullContent) {
          for (let i = 0; i < fullContent.length; i += 2) {
            if (signal && signal.aborted) break;
            sendChunk(fullContent.slice(i, i + 2));
            await new Promise((r) => setTimeout(r, 16));
          }
        }
      } catch (e) {
        console.error('[Aris v2] chatStream error', e?.message);
        const fallback = '（工具调用后的回复生成失败，请重试或换一种说法）';
        if (sendChunk) sendChunk(fallback);
        reply = fallback;
      }
    }
  }
  if (reply && isDsmlOrToolMarkup(reply)) reply = '';
  let contentForFrontend = filterReplyForDisplay(reply);
  if (sendChunk && contentForFrontend && !hadToolCalls) {
    for (let i = 0; i < contentForFrontend.length; i += 2) {
      if (signal && signal.aborted) break;
      sendChunk(contentForFrontend.slice(i, i + 2));
      await new Promise((r) => setTimeout(r, 24));
    }
  }

  await store.conversations.append(sessionId, 'assistant', reply);

  try {
    const state = store.state.readState();
    const prevRecent = await store.conversations.getRecent(sessionId, (DIALOGUE_CHUNK_PREV_ROUNDS + 1) * 2 + 2);
    const prevSlice = prevRecent.slice(-(DIALOGUE_CHUNK_PREV_ROUNDS * 2));
    const blockText = prevSlice
      .map((r) => `${r.role === 'user' ? 'User' : 'Assistant'}: ${r.content}`)
      .join(' | ');
    if (blockText && store.vector) {
      const vec = await store.vector.embed(blockText, { prefix: 'document' });
      if (vec) {
        const relatedEntities = getCurrentRelatedEntityIds();
        await store.vector.add({
          text: blockText,
          vector: vec,
          type: 'dialogue_turn',
          metadata: { session_id: sessionId, related_entities: relatedEntities },
        });
      }
    }

    store.state.writeState({
      last_active_time: new Date().toISOString(),
      last_mental_state: reply ? reply.slice(0, 300) : null,
    });

    if (store.monitor && store.monitor.recordTokenUsage) {
      if (hasOfficialUsage && (totalInputTokens > 0 || totalOutputTokens > 0)) {
        store.monitor.recordTokenUsage(sessionId, new Date().toISOString(), totalInputTokens, totalOutputTokens, false);
      } else {
        const inputChars = currentMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
        const outputChars = (reply || '').length;
        store.monitor.recordTokenUsage(sessionId, new Date().toISOString(), Math.ceil(inputChars / 4), Math.ceil(outputChars / 4), true);
      }
    }
  } catch (e) {
    console.warn('[Aris v2] 对话后处理异常（向量/状态/监控），不影响本次回复', e?.message || e);
  }

  const finalPreview = (contentForFrontend && contentForFrontend.length > 0)
    ? (contentForFrontend.length <= 200 ? contentForFrontend : contentForFrontend.slice(0, 200) + '…')
    : '(无文本回复)';
  console.info('[Aris v2] 本轮最终回复:', finalPreview);

  setImmediate(() => {
    maybeGenerateSummary(sessionId).catch((e) => console.warn('[Aris v2] 小结异步任务异常', e?.message));
  });

  return { content: contentForFrontend, error: err, sessionId };
}

async function getPromptPreview(userMessage) {
  const sessionId = await store.conversations.getCurrentSessionId();
  const recent = await store.conversations.getRecent(sessionId, RECENT_ROUNDS * 2 + 2);
  const forBuild = typeof userMessage === 'string' && userMessage.trim()
    ? [...recent, { role: 'user', content: userMessage.trim() }]
    : recent;
  const { systemPrompt, messages } = await buildPromptContext(sessionId, forBuild);
  return { systemPrompt, messages, promptText: '【系统】\n' + systemPrompt + '\n\n【对话】\n' + messages.filter((m) => m.role !== 'system').map((m) => `${m.role}: ${m.content}`).join('\n') };
}

module.exports = { handleUserMessage, getPromptPreview };