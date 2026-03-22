/**
 * v2 对话 handler：逻辑循环层。仅编排 BFF（contextBuilder + prompt）、LLM、工具、数据门面。
 */
const store = require('../../store');
const config = require('../../config');
const { buildMainDialogueMessages, buildSystemPrompt } = require('./prompt.js');
const { buildContextDTO } = require('./contextBuilder.js');
const {
  readPromptPlannerConfig,
  runPromptPlanner,
  appendPlannerMetricLine,
  LEGACY_PLAN,
} = require('./promptPlanner.js');
const { getCurrentRelatedEntityIds } = require('./associationContext.js');
const { maybeGenerateSummary } = require('./summaryGeneration.js');
const { getTools, runTool } = require('./tools/index.js');
const { chatWithTools } = require('../llm/client.js');
const { chatStream } = require('../llm/stream.js');
const {
  DIALOGUE_CHUNK_PREV_ROUNDS,
  FILE_TOOL_MAX_PER_USER_TURN,
  isFileToolName,
  getMaxToolRounds,
} = require('../../config/constants.js');
const { shouldBeQuiet, isResumingDialogue } = require('./quietResume.js');
const { appendDialogueTurnMetricLine } = require('./dialogueMetrics.js');
const asyncOutbox = require('../../store/async_outbox.js');

const RECENT_ROUNDS = 3;
const facade = store.facade;

async function buildPromptContext(sessionId, recent, options = {}) {
  const dto = await buildContextDTO(sessionId, recent);
  const lastMsg = recent.length ? recent[recent.length - 1] : null;
  const currentUserContent = lastMsg && lastMsg.role === 'user' ? lastMsg.content : (lastMsg ? lastMsg.content : '');

  const plannerCfg = readPromptPlannerConfig();
  let plan = LEGACY_PLAN;
  let plannerResult = { plan, error: 'planner_disabled', plannerMessages: null };
  let plannerMs = null;
  if (plannerCfg.enabled) {
    const tPlanner = performance.now();
    plannerResult = await runPromptPlanner({
      lastUserMessage: currentUserContent || '',
      recentWindowText: dto.recentWindowForPlanner || '',
      constraintsBriefText: dto.constraintsBriefBlock || '',
      signal: options.signal,
    });
    plannerMs = Math.round(performance.now() - tPlanner);
    plan = plannerResult.plan;
  }

  const { messages, stableSystemPrompt } = buildMainDialogueMessages(dto, plan, { enabled: plannerCfg.enabled }, recent);
  if (plannerCfg.enabled && plannerCfg.log_metrics) {
    appendPlannerMetricLine({
      planner_error: plannerResult.error,
      plan,
      system_chars: stableSystemPrompt.length,
    });
  }

  const out = {
    systemPrompt: stableSystemPrompt,
    messages,
    metrics: {
      planner_enabled: plannerCfg.enabled,
      planner_ms: plannerMs,
      system_chars: stableSystemPrompt.length,
    },
  };
  if (options.includeLegacySystem) {
    out.systemPromptLegacy = buildSystemPrompt(dto, plan, { enabled: plannerCfg.enabled });
  }
  if (options.includePlannerInPreview) {
    if (plannerCfg.enabled) {
      out.plannerPreview = {
        messages: plannerResult.plannerMessages || [],
        responseRaw: plannerResult.raw,
        plan: plannerResult.plan,
        error: plannerResult.error,
      };
    } else {
      out.plannerPreview = {
        disabled: true,
        plan: LEGACY_PLAN,
        messages: [],
        note: 'Prompt Planner 未启用（默认关闭；需设置 ARIS_PROMPT_PLANNER_ENABLED=true 或 behavior_config.json 中 prompt_planner_enabled: true）。本回合固定使用 LEGACY_PLAN（全文约束 + 全场景）。',
      };
    }
  }
  return out;
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

/** 外部渠道（如 QQ 桥接）传入的 sessionId，限制字符集与长度，避免注入异常 key */
function sanitizeExternalSessionId(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 160) return null;
  if (!/^[a-zA-Z0-9_:.-]+$/.test(s)) return null;
  return s;
}

/**
 * @param {{ sessionId?: string }} options
 */
async function resolveSessionIdForTurn(options) {
  const ext = sanitizeExternalSessionId(options && options.sessionId);
  if (ext) return ext;
  return facade.getCurrentSessionId();
}

/**
 * @param {string} userContent
 * @param {(chunk: string) => void} sendChunk
 * @param {(actions: unknown) => void} sendAgentActions
 * @param {AbortSignal} [signal]
 * @param {{ sessionId?: string }} [options] — 若传 `sessionId`（如 `qq:private:xxx`），本回合使用该会话，不读写桌面当前会话；供官方 QQ 桥接等多路隔离。
 */
async function handleUserMessage(userContent, sendChunk, sendAgentActions, signal, options = {}) {
  const sessionId = await resolveSessionIdForTurn(options);
  if (signal && signal.aborted) {
    return { content: '', error: true, sessionId, aborted: true };
  }

  if (shouldBeQuiet(userContent)) {
    facade.writeProactiveState({ low_power_mode: true, proactive_no_reply_count: 0, last_tired_or_quiet_at: new Date().toISOString() });
    console.info('[Aris v2] 用户要求安静，立即进入低功耗模式');
  } else {
    const proactiveState = facade.getProactiveState();
    if (proactiveState.low_power_mode) {
      if (isResumingDialogue(userContent)) {
        facade.writeProactiveState({ low_power_mode: false, proactive_no_reply_count: 0, low_power_entered_at: null });
        console.info('[Aris v2] 用户恢复对话，退出低功耗模式');
      }
    } else {
      facade.writeProactiveState({ proactive_no_reply_count: 0, low_power_mode: false, low_power_entered_at: null });
    }
  }

  await facade.appendConversation(sessionId, 'user', userContent);
  facade.writeProactiveState({ last_user_engaged_at: new Date().toISOString() });
  const userPreview = (typeof userContent === 'string' && userContent.length > 0)
    ? (userContent.length <= 120 ? userContent.trim() : userContent.trim().slice(0, 120) + '…')
    : '(空)';
  console.info('[Aris v2] 用户消息:', userPreview);

  const tTurnStart = performance.now();
  const recent = await facade.getRecentConversation(sessionId, RECENT_ROUNDS * 2 + 2);
  const { messages, metrics: ctxMetrics } = await buildPromptContext(sessionId, recent, { signal });
  const sysLen = (messages[0] && messages[0].content) ? String(messages[0].content).length : 0;
  console.info('[Aris v2] 本轮 prompt: 稳定 system 约', sysLen, '字, API 消息数', messages.length);

  let currentMessages = messages;
  let reply = '';
  /** 流式已发送内容累计，abort 时写入 DB 供下一轮 context（后续可迁入配置） */
  let streamedContent = '';
  let err = false;
  let hadToolCalls = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let hasOfficialUsage = false;
  let embedMs = null;
  const MAX_TOOL_ROUNDS = getMaxToolRounds();
  const allAgentActions = [];
  const toolRoundsDetail = [];
  let fileToolCount = 0;
  const fileToolLimitMsg =
    `本回合文件类工具调用已达上限（${FILE_TOOL_MAX_PER_USER_TURN}），请直接说明目标路径或换种方式描述需求。`;

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
    const namesThisRound = res.tool_calls.map((tc) => tc.function?.name || '?');
    toolRoundsDetail.push({ round, tools: namesThisRound });
    const assistantContent = sanitizeAssistantContent(res.content);
    const assistantMsg = {
      role: 'assistant',
      content: assistantContent || null,
      tool_calls: res.tool_calls,
    };
    const toolContext = { sessionId, recent, toolNames: getTools().map((t) => t.function.name) };
    const toolResults = [];
    for (const tc of res.tool_calls) {
      const name = tc.function?.name;
      const args = tc.function?.arguments;
      let result;
      if (isFileToolName(name) && fileToolCount >= FILE_TOOL_MAX_PER_USER_TURN) {
        result = { ok: false, error: fileToolLimitMsg };
      } else {
        if (isFileToolName(name)) fileToolCount += 1;
        try {
          result = await runTool(name, args, toolContext);
        } catch (e) {
          console.warn('[Aris v2] runTool error', name, e?.message);
          result = { ok: false, error: String(e?.message || '执行异常') };
        }
      }
      toolResults.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
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
    const partial = (streamedContent || reply || '').trim() || '[已停止]';
    await facade.appendConversation(sessionId, 'assistant', partial);
    return { content: partial, error: false, sessionId, aborted: true };
  }

  // 有工具调用时：若本轮已有可用正文，直接用它并流式输出；仅当无正文或为 DSML/工具标记时才再调 chatStream 要一句总结
  if (hadToolCalls && currentMessages.length > 0) {
    const hasUsableReply = reply && String(reply).trim() && !isDsmlOrToolMarkup(reply);
    if (hasUsableReply) {
      if (sendChunk) {
        const contentForStream = filterReplyForDisplay(reply);
        for (let i = 0; i < contentForStream.length; i += 2) {
          if (signal && signal.aborted) break;
          const slice = contentForStream.slice(i, i + 2);
          streamedContent += slice;
          sendChunk(slice);
          await new Promise((r) => setTimeout(r, 16));
        }
        if (signal && signal.aborted) {
          const partial = (streamedContent || reply || '').trim() || '[已停止]';
          await facade.appendConversation(sessionId, 'assistant', partial);
          return { content: partial, error: false, sessionId, aborted: true };
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
          const msg = '（上轮为工具调用，未生成自然语言回复，可继续发消息）';
          if (sendChunk) { streamedContent += msg; sendChunk(msg); }
          reply = '';
        } else if (sendChunk && fullContent) {
          for (let i = 0; i < fullContent.length; i += 2) {
            if (signal && signal.aborted) break;
            const slice = fullContent.slice(i, i + 2);
            streamedContent += slice;
            sendChunk(slice);
            await new Promise((r) => setTimeout(r, 16));
          }
          if (signal && signal.aborted) {
            const partial = (streamedContent || reply || '').trim() || '[已停止]';
            await facade.appendConversation(sessionId, 'assistant', partial);
            return { content: partial, error: false, sessionId, aborted: true };
          }
        }
      } catch (e) {
        console.error('[Aris v2] chatStream error', e?.message);
        const fallback = '（工具调用后的回复生成失败，请重试或换一种说法）';
        if (sendChunk) { streamedContent += fallback; sendChunk(fallback); }
        reply = fallback;
      }
    }
  }
  if (reply && isDsmlOrToolMarkup(reply)) reply = '';
  let contentForFrontend = filterReplyForDisplay(reply);
  if (sendChunk && contentForFrontend && !hadToolCalls) {
    for (let i = 0; i < contentForFrontend.length; i += 2) {
      if (signal && signal.aborted) break;
      const slice = contentForFrontend.slice(i, i + 2);
      streamedContent += slice;
      sendChunk(slice);
      await new Promise((r) => setTimeout(r, 24));
    }
    if (signal && signal.aborted) {
      const partial = (streamedContent || reply || '').trim() || '[已停止]';
      await facade.appendConversation(sessionId, 'assistant', partial);
      return { content: partial, error: false, sessionId, aborted: true };
    }
  }

  await facade.appendConversation(sessionId, 'assistant', reply);

  try {
    const prevRecent = await facade.getRecentConversation(sessionId, (DIALOGUE_CHUNK_PREV_ROUNDS + 1) * 2 + 2);
    const prevSlice = prevRecent.slice(-(DIALOGUE_CHUNK_PREV_ROUNDS * 2));
    const blockText = prevSlice
      .map((r) => `${r.role === 'user' ? 'User' : 'Assistant'}: ${r.content}`)
      .join(' | ');

    if (asyncOutbox.isEnabled()) {
      facade.writeState({
        last_active_time: new Date().toISOString(),
        last_mental_state: reply ? reply.slice(0, 300) : null,
      });
      const enqueues = [];
      if (blockText) {
        enqueues.push(
          asyncOutbox.enqueue('vector_dialogue', {
            blockText,
            sessionId,
            relatedEntities: getCurrentRelatedEntityIds(),
          }),
        );
      }
      if (store.monitor && store.monitor.recordTokenUsage) {
        const roundId = new Date().toISOString();
        if (hasOfficialUsage && (totalInputTokens > 0 || totalOutputTokens > 0)) {
          enqueues.push(
            asyncOutbox.enqueue('token_usage', {
              sessionId,
              roundId,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              isEstimated: false,
            }),
          );
        } else {
          const inputChars = currentMessages.reduce((sum, m) => sum + (typeof m.content === 'string' ? m.content.length : 0), 0);
          const outputChars = (reply || '').length;
          enqueues.push(
            asyncOutbox.enqueue('token_usage', {
              sessionId,
              roundId,
              inputTokens: Math.ceil(inputChars / 4),
              outputTokens: Math.ceil(outputChars / 4),
              isEstimated: true,
            }),
          );
        }
      }
      await Promise.all(enqueues);
    } else {
      if (blockText) {
        const tEmb = performance.now();
        const vec = await facade.embedForDialogue(blockText, { prefix: 'document' });
        embedMs = Math.round(performance.now() - tEmb);
        if (vec) {
          const relatedEntities = getCurrentRelatedEntityIds();
          await facade.addVectorBlock({
            text: blockText,
            vector: vec,
            type: 'dialogue_turn',
            metadata: { session_id: sessionId, related_entities: relatedEntities },
          });
        }
      }

      facade.writeState({
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
    }
  } catch (e) {
    console.warn('[Aris v2] 对话后处理异常（向量/状态/监控），不影响本次回复', e?.message || e);
  }

  const finalPreview = (contentForFrontend && contentForFrontend.length > 0)
    ? (contentForFrontend.length <= 200 ? contentForFrontend : contentForFrontend.slice(0, 200) + '…')
    : '(无文本回复)';
  console.info('[Aris v2] 本轮最终回复:', finalPreview);

  const metricLine = {
    session_id: sessionId,
    planner_ms: ctxMetrics && ctxMetrics.planner_ms != null ? ctxMetrics.planner_ms : null,
    planner_enabled: !!(ctxMetrics && ctxMetrics.planner_enabled),
    system_chars: ctxMetrics && ctxMetrics.system_chars != null ? ctxMetrics.system_chars : sysLen,
    tool_rounds: toolRoundsDetail.length,
    tool_rounds_detail: toolRoundsDetail,
    file_tool_calls: fileToolCount,
    embed_ms: asyncOutbox.isEnabled() ? null : embedMs,
    vector_async: asyncOutbox.isEnabled() ? true : undefined,
    total_turn_ms: Math.round(performance.now() - tTurnStart),
    total_input_tokens: totalInputTokens,
    total_output_tokens: totalOutputTokens,
    had_tool_calls: hadToolCalls,
  };
  if (asyncOutbox.isEnabled()) {
    try {
      await asyncOutbox.enqueue('dialogue_metric', { entry: metricLine });
    } catch (e) {
      console.warn('[Aris v2] dialogue_metric 入队失败', e?.message || e);
    }
  } else {
    appendDialogueTurnMetricLine(metricLine);
  }

  setImmediate(() => {
    maybeGenerateSummary(sessionId).catch((e) => console.warn('[Aris v2] 小结异步任务异常', e?.message));
  });

  return { content: contentForFrontend, error: err, sessionId };
}

function formatMessagesBlock(msgs) {
  if (!Array.isArray(msgs) || !msgs.length) return '';
  return msgs.map((m) => `【${m.role}】\n${m.content ?? ''}`).join('\n\n---\n\n');
}

async function getPromptPreview(userMessage) {
  const sessionId = await facade.getCurrentSessionId();
  const recent = await facade.getRecentConversation(sessionId, RECENT_ROUNDS * 2 + 2);
  const forBuild = typeof userMessage === 'string' && userMessage.trim()
    ? [...recent, { role: 'user', content: userMessage.trim() }]
    : recent;
  const ctx = await buildPromptContext(sessionId, forBuild, {
    includePlannerInPreview: true,
    includeLegacySystem: true,
  });

  let plannerSectionText = '';
  const pp = ctx.plannerPreview;
  if (pp?.disabled) {
    plannerSectionText = `${pp.note}\n\n生效 plan（JSON）：\n${JSON.stringify(pp.plan, null, 2)}`;
  } else if (pp?.messages?.length) {
    plannerSectionText =
      formatMessagesBlock(pp.messages) +
      '\n\n---\n\n【assistant 返回（原始）】\n' +
      (pp.responseRaw || '（无）');
    if (pp.error) plannerSectionText += `\n\n（状态：${pp.error}）`;
    plannerSectionText += `\n\n生效 plan（JSON）：\n${JSON.stringify(pp.plan, null, 2)}`;
  } else {
    plannerSectionText = '（无 Planner 消息）';
  }

  const mainSectionText = formatMessagesBlock(ctx.messages);
  const legacyNote =
    ctx.systemPromptLegacy != null
      ? `\n\n---------- 对照：旧版单条 system（已拆分为上列多段 messages）----------\n约 ${ctx.systemPromptLegacy.length} 字\n${ctx.systemPromptLegacy.slice(0, 2000)}${ctx.systemPromptLegacy.length > 2000 ? '\n…（截断）' : ''}`
      : '';

  const promptText =
    '========== ① Prompt Planner（编排 LLM）==========\n\n' +
    plannerSectionText +
    '\n\n========== ② 主对话（多段 messages，利于 DeepSeek 前缀缓存）==========\n\n' +
    mainSectionText +
    legacyNote;

  return {
    systemPrompt: ctx.systemPrompt,
    messages: ctx.messages,
    plannerPreview: ctx.plannerPreview,
    plannerSectionText,
    mainSectionText,
    promptText,
  };
}

module.exports = { handleUserMessage, getPromptPreview };