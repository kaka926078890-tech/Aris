/**
 * v2 对话 handler：方案 A prompt，工具循环，仅通过工具写入记录，禁止解析用户/助手文本。
 */
const store = require('../../store');
const config = require('../../config');
const { buildSystemPrompt } = require('./prompt.js');
const { ALL_TOOLS, runTool } = require('./tools/index.js');
const { chatWithTools } = require('../llm/client.js');
const { chatStream } = require('../llm/stream.js');
const { DIALOGUE_CHUNK_PREV_ROUNDS } = require('../../config/constants.js');

const RECENT_ROUNDS = 5;

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
  const systemPrompt = buildSystemPrompt({
    userIdentity,
    userRequirements,
    contextWindow,
    lastStateAndSubjectiveTime,
  });
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
  store.state.writeProactiveState({ proactive_no_reply_count: 0, low_power_mode: false });

  await store.conversations.append(sessionId, 'user', userContent);
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

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (signal && signal.aborted) break;
    const res = await chatWithTools(currentMessages, ALL_TOOLS, signal);
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
    const toolResults = await Promise.all(
      res.tool_calls.map(async (tc) => {
        const name = tc.function?.name;
        const args = tc.function?.arguments;
        let result;
        try {
          result = await runTool(name, args);
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
    if (typeof sendAgentActions === 'function') {
      sendAgentActions(res.tool_calls.map((tc, i) => ({
        name: tc.function?.name,
        args: tc.function?.arguments,
        result: toolResults[i]?.content,
      })));
    }
    currentMessages = [...currentMessages, assistantMsg, ...toolResults];
  }

  if (signal && signal.aborted) {
    await store.conversations.append(sessionId, 'assistant', reply || '[已停止]');
    return { content: reply || '', error: false, sessionId, aborted: true };
  }

  if (hadToolCalls && currentMessages.length > 0) {
    try {
      const streamRes = await chatStream(currentMessages, sendChunk || null, signal);
      reply = streamRes.content || reply;
      if (streamRes.usage) {
        totalInputTokens += Number(streamRes.usage.prompt_tokens) || 0;
        totalOutputTokens += Number(streamRes.usage.completion_tokens) || 0;
        hasOfficialUsage = true;
      }
    } catch (e) {
      console.error('[Aris v2] chatStream error', e?.message);
      if (!reply || isDsmlOrToolMarkup(reply)) reply = '（工具调用后的回复生成失败，请重试或换一种说法）';
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

  const state = store.state.readState();
  const prevRecent = await store.conversations.getRecent(sessionId, (DIALOGUE_CHUNK_PREV_ROUNDS + 1) * 2 + 2);
  const prevSlice = prevRecent.slice(-(DIALOGUE_CHUNK_PREV_ROUNDS * 2));
  const blockText = prevSlice
    .map((r) => `${r.role === 'user' ? 'User' : 'Assistant'}: ${r.content}`)
    .join(' | ');
  if (blockText && store.vector) {
    const vec = await store.vector.embed(blockText, { prefix: 'document' });
    if (vec) {
      await store.vector.add({
        text: blockText,
        vector: vec,
        type: 'dialogue_turn',
        metadata: { session_id: sessionId },
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
