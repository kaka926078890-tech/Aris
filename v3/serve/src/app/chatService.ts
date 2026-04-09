import type {
  ILLMClient,
  IEmbeddingClient,
  IVectorStore,
  IConversationRepo,
  IMessageRepo,
  IRecordRepo,
  ChatRequest,
  ChatResponse,
  ChatPreviewRequest,
  ChatPreviewResponse,
  Message,
  PromptMessage,
  PromptPolicyConfig,
  ToolTraceCall,
  ToolTraceRound,
} from '../types.js';
import {
  PromptBuilder,
  mergeToolAndRuntimePolicyIntoMessages,
} from './promptBuilder.js';
import { loadPromptPolicy, estimateTokens } from './promptPolicy.js';
import { ChatTools } from './chatTools.js';
import { TimelineRepo } from '../infra/timelineRepo.js';
import { CompactionRepo } from '../infra/compactionRepo.js';
import { ConversationContextRepo } from '../infra/conversationContextRepo.js';
import { ToolSummaryRepo } from '../infra/toolSummaryRepo.js';
import { NotFoundError } from '../errors.js';
import { logger } from '../logger.js';
import { buildToolPolicyMessage } from './toolPolicy.js';
import { sanitizeAssistantOutput } from './outputSanitizer.js';
import {
  applyRuntimeConsequences,
  buildRuntimePolicyMessage,
  executeRuntimePolicy,
  type RuntimePolicyExecution,
} from './runtimePolicy.js';
import { config } from '../config.js';

interface RetrievalHitDebug {
  scope: 'current' | 'cross';
  kind: 'turn' | 'message';
  score: number;
  text_preview: string;
}

interface RetrievalResult {
  lines: string[];
  debug: {
    candidates: number;
    candidates_after_scope_filter: number;
    dropped_current: number;
    dropped_dedup: number;
    selected: number;
    selected_turn: number;
    selected_message: number;
    hits: RetrievalHitDebug[];
  };
}

/** 工具轮用尽后，追加 system 约束，请求一轮不传 tools 的总结 */
const TOOL_EXHAUSTION_NUDGE_SYSTEM =
  '【本回合约束】已达到本回合工具调用轮次上限，或尚未产生可直接展示给用户的正文。请仅根据当前对话中已有的内容（含工具返回）用自然语言直接回复用户；禁止再输出工具调用。若已有信息不足以准确回答，请明确说明局限与建议下一步。';

const TOOL_EXHAUSTION_STATIC =
  '【降级提示】本回合已达到工具调用次数上限，暂时无法继续调用工具。请尝试把问题拆小、补充关键信息，或在新的一轮对话中重试。';

const TOOL_EXHAUSTION_USER_PREFIX =
  '【提示】本回合工具调用次数已达上限；以下仅依据已返回的工具结果与上文作答。\n\n';

function retrievalScoreWithDecay(
  score: number,
  createdAt: string | undefined,
  lambdaPerDay: number,
): number {
  if (!lambdaPerDay || lambdaPerDay <= 0 || !createdAt) return score;
  const days = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  if (days <= 0) return score;
  return score * Math.exp(-days * lambdaPerDay);
}

export class ChatService {
  private policy: PromptPolicyConfig;
  private promptBuilder: PromptBuilder;
  private chatTools: ChatTools;
  private compactionRepo = new CompactionRepo();
  private timelineRepo = new TimelineRepo();
  private contextRepo = new ConversationContextRepo();
  private toolSummaryRepo = new ToolSummaryRepo();

  constructor(
    private llmClient: ILLMClient,
    private embeddingClient: IEmbeddingClient,
    private vectorStore: IVectorStore,
    private conversationRepo: IConversationRepo,
    private messageRepo: IMessageRepo,
    private recordRepo: IRecordRepo,
  ) {
    this.policy = loadPromptPolicy();
    this.promptBuilder = new PromptBuilder();
    this.chatTools = new ChatTools(
      recordRepo,
      embeddingClient,
      vectorStore,
      conversationRepo,
      messageRepo,
      new TimelineRepo(),
      this.contextRepo,
    );
  }

  async preview(req: ChatPreviewRequest): Promise<ChatPreviewResponse> {
    const conversation = this.resolveConversation(req.conversation_id);
    const conversationId = conversation?.id ?? null;

    const { history, compaction_summary } = conversationId
      ? this.assembleHistoryForPrompt(conversationId, null)
      : { history: [] as Message[], compaction_summary: null as string | null };
    const userText = this.buildUserTextWithReply(req);
    const runtimePolicy = this.resolveRuntimePolicy(userText);
    const retrieval = await this.retrieveRelevantMemories(
      userText,
      conversationId ?? '',
    );
    const recordContext = this.buildRecordContextLines();
    const sessionNote = conversationId
      ? this.contextRepo.getSessionNote(conversationId)
      : null;
    const toolSummaries = conversationId
      ? this.toolSummaryRepo
          .list_recent(conversationId, 10)
          .slice()
          .reverse()
          .map((r) => `[${r.tool_name}] ${r.summary_text}`)
      : [];
    const built = this.promptBuilder.build(this.policy, history, userText, {
      compaction_summary,
      record_lines: recordContext,
      retrieval_lines: retrieval.lines,
      session_note: sessionNote,
      tool_summaries: toolSummaries,
    });
    const trace = {
      ...built,
      messages: mergeToolAndRuntimePolicyIntoMessages(
        built.messages,
        buildToolPolicyMessage(),
        buildRuntimePolicyMessage(runtimePolicy),
      ),
    };

    return { conversation_id: conversationId, trace };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const wallStartedAt = Date.now();
    // 1) 查询或创建会话
    let conversation = this.resolveConversation(req.conversation_id);
    if (!conversation) {
      conversation = this.conversationRepo.create();
    }
    this.conversationRepo.set_current_id(conversation.id);

    // 2) 先保存用户消息
    const userMsg = this.messageRepo.create(
      conversation.id,
      'user',
      req.message,
    );

    await this.maybeCompactIfNeeded(conversation.id, userMsg.id, req.model);

    const { history, compaction_summary } = this.assembleHistoryForPrompt(
      conversation.id,
      userMsg.id,
    );
    const userText = this.buildUserTextWithReply(req);
    const runtimePolicy = this.resolveRuntimePolicy(userText);
    const runtimePrefetch = await this.runRuntimePolicyPrefetch(
      runtimePolicy,
      conversation.id,
      userMsg.id,
      -1,
    );
    const retrieval = await this.retrieveRelevantMemories(
      userText,
      conversation.id,
    );
    const recordContext = this.buildRecordContextLines();
    const sessionNote = this.contextRepo.getSessionNote(conversation.id);
    const toolSummaries = this.toolSummaryRepo
      .list_recent(conversation.id, 10)
      .slice()
      .reverse()
      .map((r) => `[${r.tool_name}] ${r.summary_text}`);
    const promptPackage = this.promptBuilder.build(this.policy, history, userText, {
      compaction_summary,
      record_lines: recordContext,
      retrieval_lines: retrieval.lines,
      session_note: sessionNote,
      tool_summaries: toolSummaries,
      runtime_facts: runtimePrefetch.facts,
    });
    const messagesForLlm = mergeToolAndRuntimePolicyIntoMessages(
      promptPackage.messages,
      buildToolPolicyMessage(),
      buildRuntimePolicyMessage(runtimePolicy),
    );

    const promptChars = promptPackage.messages.map((m) => m.content.length);
    const roleCounts = {
      system: promptPackage.messages.filter((m) => m.role === 'system').length,
      user: promptPackage.messages.filter((m) => m.role === 'user').length,
      assistant: promptPackage.messages.filter((m) => m.role === 'assistant').length,
    };
    logger.debug(
      {
        conversation_id: conversation.id,
        token_usage: promptPackage.token_usage,
        prompt_messages: promptPackage.messages.length,
        prompt_role_counts: roleCounts,
        prompt_chars_total: promptChars.reduce((a, b) => a + b, 0),
        prompt_chars_max: promptChars.length ? Math.max(...promptChars) : 0,
        retrieval: retrieval.debug,
        record_context_lines: recordContext.length,
        runtime_policy_matched: runtimePolicy.stats.rules_hit,
        runtime_policy_consequence_hits: runtimePolicy.stats.consequence_applied_count,
        runtime_prefetch_tools: runtimePrefetch.calls.map((c) => c.tool_name),
      },
      '提示词已组装',
    );

    // 4) 调用对话模型（含工具层）
    const llmRes = await this.runChatWithTools(
      messagesForLlm,
      req.model,
      conversation.id,
      runtimePrefetch.calls,
    );
    const sanitized = sanitizeAssistantOutput(llmRes.content || '');
    const consequenceRes = applyRuntimeConsequences(sanitized, runtimePolicy);
    llmRes.content = consequenceRes.text;

    // 5) 保存助手回复
    const assistantMsg = this.messageRepo.create(
      conversation.id,
      'assistant',
      llmRes.content,
      llmRes.completion_tokens,
      {
        tool_trace: llmRes.tool_trace,
        runtime_policy: {
          matched_rules: runtimePolicy.stats.rules_hit,
          consequence_hits: runtimePolicy.stats.consequence_hits,
          post_applied: consequenceRes.applied,
        },
      },
    );

    // 6) 首轮自动设置标题
    if (this.messageRepo.count_by_conversation(conversation.id) <= 2) {
      this.conversationRepo.update_title(
        conversation.id,
        req.message.slice(0, 100),
      );
    }

    // 7) 同步向量化并落库（简单直接）
    try {
      const { vectors } = await this.embeddingClient.embed([
        userMsg.content,
        assistantMsg.content,
        this.buildTurnText(userMsg.content, assistantMsg.content),
      ]);
      if (vectors[0]) {
        await this.vectorStore.upsert(userMsg.id, vectors[0], {
          message_id: userMsg.id,
          conversation_id: conversation.id,
          source_kind: 'message',
          source_text: userMsg.content,
          source_created_at: userMsg.created_at,
        });
      }
      if (vectors[1]) {
        await this.vectorStore.upsert(assistantMsg.id, vectors[1], {
          message_id: assistantMsg.id,
          conversation_id: conversation.id,
          source_kind: 'message',
          source_text: assistantMsg.content,
          source_created_at: assistantMsg.created_at,
        });
      }
      if (vectors[2]) {
        const turnText = this.buildTurnText(userMsg.content, assistantMsg.content);
        await this.vectorStore.upsert(`turn:${assistantMsg.id}`, vectors[2], {
          message_id: assistantMsg.id,
          conversation_id: conversation.id,
          source_kind: 'turn',
          source_text: turnText,
          source_created_at: assistantMsg.created_at,
        });
      }
    } catch (err) {
      logger.warn({ err }, '向量化失败，不影响主对话');
    }

    logger.info(
      {
        conversation_id: conversation.id,
        wall_ms: Date.now() - wallStartedAt,
        completion_tokens: llmRes.completion_tokens,
        tool_rounds: llmRes.tool_trace.length,
        tools_used: llmRes.tool_trace.some((r) => r.used_tools),
        runtime_policy_matched: runtimePolicy.stats.rules_hit,
        runtime_policy_consequence_hits: runtimePolicy.stats.consequence_applied_count,
        runtime_policy_post_applied: consequenceRes.applied,
        runtime_prefetch_tools: runtimePrefetch.calls.map((c) => c.tool_name),
        assistant_chars: assistantMsg.content.length,
      },
      'chat 完成',
    );

    return {
      conversation_id: conversation.id,
      message: assistantMsg,
      model: llmRes.model,
      tool_trace: llmRes.tool_trace,
      trace: req.include_trace ? promptPackage : undefined,
    };
  }

  /**
   * Server-sent-events streaming chat.
   * Sends tool rounds (if any) as discrete events and streams final assistant text as deltas.
   *
   * Important: if tools are invoked, we do NOT stream the "assistant thinking" text before tools;
   * we only stream the final assistant answer in the last round (no tool calls).
   */
  async chat_stream(
    req: ChatRequest,
    hooks: {
      on_open: (payload: { conversation_id: string }) => void;
      on_tool_trace: (payload: { tool_trace: ToolTraceRound[] }) => void;
      on_delta: (payload: { delta: string }) => void;
      on_final: (payload: ChatResponse) => void;
      on_error: (payload: { error: string }) => void;
    },
  ): Promise<void> {
    const wallStartedAt = Date.now();
    // 1) resolve/create conversation
    let conversation = this.resolveConversation(req.conversation_id);
    if (!conversation) conversation = this.conversationRepo.create();
    this.conversationRepo.set_current_id(conversation.id);
    hooks.on_open({ conversation_id: conversation.id });

    // 2) persist user message
    const userMsg = this.messageRepo.create(conversation.id, 'user', req.message);

    await this.maybeCompactIfNeeded(conversation.id, userMsg.id, req.model);

    const { history, compaction_summary } = this.assembleHistoryForPrompt(
      conversation.id,
      userMsg.id,
    );
    const userText = this.buildUserTextWithReply(req);
    const runtimePolicy = this.resolveRuntimePolicy(userText);
    const runtimePrefetch = await this.runRuntimePolicyPrefetch(
      runtimePolicy,
      conversation.id,
      userMsg.id,
      -1,
    );
    const retrieval = await this.retrieveRelevantMemories(userText, conversation.id);
    const recordContext = this.buildRecordContextLines();
    const sessionNote = this.contextRepo.getSessionNote(conversation.id);
    const toolSummaries = this.toolSummaryRepo
      .list_recent(conversation.id, 10)
      .slice()
      .reverse()
      .map((r) => `[${r.tool_name}] ${r.summary_text}`);
    const promptPackage = this.promptBuilder.build(this.policy, history, userText, {
      compaction_summary,
      record_lines: recordContext,
      retrieval_lines: retrieval.lines,
      session_note: sessionNote,
      tool_summaries: toolSummaries,
      runtime_facts: runtimePrefetch.facts,
    });
    const messages = mergeToolAndRuntimePolicyIntoMessages(
      promptPackage.messages,
      buildToolPolicyMessage(),
      buildRuntimePolicyMessage(runtimePolicy),
    );

    // 4) run with tools; stream final answer deltas if supported
    const tools = this.chatTools.getDefinitions();

    const maxToolRounds = config.llm.max_tool_rounds;
    let finalContent = '';
    let modelName = req.model || 'unknown';
    let completionTokens = 0;
    const toolTrace: ToolTraceRound[] = [];
    if (runtimePrefetch.calls.length > 0) {
      toolTrace.push({
        round: -1,
        used_tools: true,
        assistant_content: '[runtime_policy_prefetch]',
        tool_calls: runtimePrefetch.calls,
      });
      hooks.on_tool_trace({ tool_trace: [...toolTrace] });
    }

    try {
      // Prefer single-call streaming path.
      // If stream emits tool calls, fall back to non-stream tool rounds.
      let initialToolCalls: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }> = [];
      let initialAssistantText = '';
      if (typeof this.llmClient.chat_stream === 'function') {
        const streamToolCalls = new Map<
          number,
          { id: string; type: 'function'; function: { name: string; arguments: string } }
        >();
        let sawToolCallsInStream = false;

        for await (const chunk of this.llmClient.chat_stream(messages, req.model, tools)) {
          modelName = chunk.model || modelName;
          if (chunk.usage) {
            const ct = Number(chunk.usage.completion_tokens);
            if (!Number.isNaN(ct) && ct >= 0) completionTokens += ct;
          }
          if (chunk.tool_calls?.length) {
            sawToolCallsInStream = true;
            mergeStreamToolCalls(streamToolCalls, chunk.tool_calls as Array<Record<string, unknown>>);
          }
          if (chunk.delta) {
            initialAssistantText += chunk.delta;
            // Only stream to client when we are still on "no-tools" path.
            if (!sawToolCallsInStream) {
              hooks.on_delta({ delta: chunk.delta });
            }
          }
        }

        if (!sawToolCallsInStream) {
          toolTrace.push({
            round: 0,
            used_tools: false,
            assistant_content: sanitizeAssistantOutput(initialAssistantText),
            tool_calls: [],
          });
          finalContent = sanitizeAssistantOutput(initialAssistantText);
        } else {
          initialToolCalls = [...streamToolCalls.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([, call]) => call)
            .filter((call) => call.function.name);
        }
      }

      // Stream path produced no-tool final answer in one request.
      if (finalContent) {
        // nothing else to do
      } else {
        // Fallback: tool rounds via non-stream chat.
        let round = 0;
        if (initialToolCalls.length > 0) {
          messages.push({
            role: 'assistant',
            content: initialAssistantText || '',
            tool_calls: initialToolCalls,
          });
          const roundTrace: ToolTraceRound = {
            round,
            used_tools: true,
            assistant_content: sanitizeAssistantOutput(initialAssistantText || ''),
            tool_calls: [],
          };
          for (const call of initialToolCalls) {
            const args = safeJsonParse(call.function.arguments);
            const result = await this.chatTools.run(call.function.name, args, {
              conversation_id: conversation.id,
            });
            this.persistToolSummary(
              conversation.id,
              userMsg.id,
              round,
              call.function.name,
              result,
            );
            roundTrace.tool_calls.push({
              tool_name: call.function.name,
              tool_args: args,
              tool_result: result,
            });
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(result),
            });
          }
          toolTrace.push(roundTrace);
          hooks.on_tool_trace({ tool_trace: [...toolTrace] });
          round = 1;
        }

        for (; round < maxToolRounds; round++) {
          const res = await this.llmClient.chat(messages, req.model, tools);
          modelName = res.model;
          completionTokens += res.completion_tokens;

          if (res.tool_calls.length > 0) {
            messages.push({
              role: 'assistant',
              content: res.content || '',
              tool_calls: res.tool_calls,
            });
            const roundTrace: ToolTraceRound = {
              round,
              used_tools: true,
              assistant_content: sanitizeAssistantOutput(res.content || ''),
              tool_calls: [],
            };
            for (const call of res.tool_calls) {
              const args = safeJsonParse(call.function.arguments);
              const result = await this.chatTools.run(call.function.name, args, {
                conversation_id: conversation.id,
              });
              this.persistToolSummary(
                conversation.id,
                userMsg.id,
                round,
                call.function.name,
                result,
              );
              roundTrace.tool_calls.push({
                tool_name: call.function.name,
                tool_args: args,
                tool_result: result,
              });
              messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
              });
            }
            toolTrace.push(roundTrace);
            hooks.on_tool_trace({ tool_trace: [...toolTrace] });
            continue;
          }

          toolTrace.push({
            round,
            used_tools: false,
            assistant_content: sanitizeAssistantOutput(res.content || ''),
            tool_calls: [],
          });
          finalContent = sanitizeAssistantOutput(res.content || '');
          break;
        }
      }

      if (!sanitizeAssistantOutput(finalContent).trim()) {
        logger.warn(
          { max_tool_rounds: maxToolRounds, tool_trace_rounds: toolTrace.length },
          '工具轮结束仍无正文，补发无工具总结',
        );
        const r = await this.tryNoToolsSummaryReply(messages, req.model);
        completionTokens += r.completion_tokens;
        modelName = r.model || modelName;
        finalContent = this.composeToolExhaustionReply(r.text);
        toolTrace.push({
          round: maxToolRounds,
          used_tools: false,
          assistant_content: finalContent,
          tool_calls: [],
          forced_text_only: true,
        });
        hooks.on_tool_trace({ tool_trace: [...toolTrace] });
        hooks.on_delta({ delta: finalContent });
      }

      const consequenceRes = applyRuntimeConsequences(
        sanitizeAssistantOutput(finalContent || ''),
        runtimePolicy,
      );
      finalContent = consequenceRes.text;

      const assistantMsg = this.messageRepo.create(
        conversation.id,
        'assistant',
        finalContent,
        completionTokens,
        {
          tool_trace: toolTrace,
          runtime_policy: {
            matched_rules: runtimePolicy.stats.rules_hit,
            consequence_hits: runtimePolicy.stats.consequence_hits,
            post_applied: consequenceRes.applied,
          },
        },
      );

      if (this.messageRepo.count_by_conversation(conversation.id) <= 2) {
        this.conversationRepo.update_title(conversation.id, req.message.slice(0, 100));
      }

      // embedding persistence (same as non-stream path)
      try {
        const { vectors } = await this.embeddingClient.embed([
          userMsg.content,
          assistantMsg.content,
          this.buildTurnText(userMsg.content, assistantMsg.content),
        ]);
        if (vectors[0]) {
          await this.vectorStore.upsert(userMsg.id, vectors[0], {
            message_id: userMsg.id,
            conversation_id: conversation.id,
            source_kind: 'message',
            source_text: userMsg.content,
            source_created_at: userMsg.created_at,
          });
        }
        if (vectors[1]) {
          await this.vectorStore.upsert(assistantMsg.id, vectors[1], {
            message_id: assistantMsg.id,
            conversation_id: conversation.id,
            source_kind: 'message',
            source_text: assistantMsg.content,
            source_created_at: assistantMsg.created_at,
          });
        }
        if (vectors[2]) {
          const turnText = this.buildTurnText(userMsg.content, assistantMsg.content);
          await this.vectorStore.upsert(`turn:${assistantMsg.id}`, vectors[2], {
            message_id: assistantMsg.id,
            conversation_id: conversation.id,
            source_kind: 'turn',
            source_text: turnText,
            source_created_at: assistantMsg.created_at,
          });
        }
      } catch (err) {
        logger.warn({ err }, '向量化失败，不影响主对话');
      }

      const result: ChatResponse = {
        conversation_id: conversation.id,
        message: assistantMsg,
        model: modelName,
        tool_trace: toolTrace,
        trace: req.include_trace ? promptPackage : undefined,
      };
      logger.info(
        {
          conversation_id: conversation.id,
          wall_ms: Date.now() - wallStartedAt,
          completion_tokens: completionTokens,
          tool_rounds: toolTrace.length,
          tools_used: toolTrace.some((r) => r.used_tools),
          runtime_policy_matched: runtimePolicy.stats.rules_hit,
          runtime_policy_consequence_hits: runtimePolicy.stats.consequence_applied_count,
          runtime_policy_post_applied: consequenceRes.applied,
          runtime_prefetch_tools: runtimePrefetch.calls.map((c) => c.tool_name),
          assistant_chars: assistantMsg.content.length,
        },
        'chat_stream 完成',
      );
      hooks.on_final(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      hooks.on_error({ error: msg });
    }
  }

  private composeToolExhaustionReply(modelText: string): string {
    const t = sanitizeAssistantOutput(modelText).trim();
    if (t) return `${TOOL_EXHAUSTION_USER_PREFIX}${t}`;
    return TOOL_EXHAUSTION_STATIC;
  }

  private async tryNoToolsSummaryReply(
    messages: PromptMessage[],
    model?: string,
  ): Promise<{ text: string; completion_tokens: number; model: string }> {
    const forced: PromptMessage[] = [
      ...messages,
      { role: 'system', content: TOOL_EXHAUSTION_NUDGE_SYSTEM },
    ];
    const res = await this.llmClient.chat(forced, model, undefined);
    return {
      text: sanitizeAssistantOutput(res.content || ''),
      completion_tokens: res.completion_tokens,
      model: res.model,
    };
  }

  private buildTurnText(userText: string, assistantText: string): string {
    return `用户：${userText}\nAris：${assistantText}`;
  }

  /** 结构化指代：reply_to_message_id */
  private buildUserTextWithReply(
    req: ChatRequest | ChatPreviewRequest,
  ): string {
    const rid = req.reply_to_message_id?.trim();
    if (!rid) return req.message;
    const ref = this.messageRepo.find_by_id(rid);
    if (!ref) return req.message;
    const snippet = ref.content.replace(/\s+/g, ' ').trim().slice(0, 500);
    const label = ref.role === 'assistant' ? '上一条回复' : '引用消息';
    return `[回复引用 id=${ref.id} · ${label}]\n${snippet}\n---\n${req.message}`;
  }

  /** Session pruning：旧轮 assistant 的 tool_trace 不进 prompt，省 token、减干扰 */
  private pruneAssistantToolMetadata(messages: Message[]): Message[] {
    const keep = this.policy.compaction.prune_metadata_keep_last;
    const n = messages.length;
    return messages.map((m, i) => {
      if (m.role !== 'assistant' || !m.metadata || i >= n - keep) return m;
      const meta = { ...(m.metadata as Record<string, unknown>) };
      delete meta.tool_trace;
      const keys = Object.keys(meta);
      return {
        ...m,
        metadata: keys.length ? (meta as Record<string, unknown>) : null,
      };
    });
  }

  /**
   * Transcript 全量在 DB；进窗时：compaction 摘要 + 从 first_kept 起的原文 + 裁剪元数据。
   */
  private assembleHistoryForPrompt(
    conversationId: string,
    excludeUserMessageId: string | null,
  ): { history: Message[]; compaction_summary: string | null } {
    const all = this.messageRepo
      .find_by_conversation(conversationId, 5000, 0, 'asc')
      .filter((m) => (excludeUserMessageId ? m.id !== excludeUserMessageId : true));
    const row = this.compactionRepo.get(conversationId);
    if (!row) {
      return {
        history: this.pruneAssistantToolMetadata(all),
        compaction_summary: null,
      };
    }
    const anchor = this.messageRepo.find_by_id(row.first_kept_message_id);
    if (!anchor) {
      return {
        history: this.pruneAssistantToolMetadata(all),
        compaction_summary: null,
      };
    }
    const idx = all.findIndex((m) => m.id === anchor.id);
    const verbatim = idx === -1 ? all : all.slice(idx);
    return {
      history: this.pruneAssistantToolMetadata(verbatim),
      compaction_summary: row.summary_text,
    };
  }

  /**
   * OpenClaw 式：超预算或过长时把更早部分压成摘要，尾部永远保留原文。
   * Compaction 前写入时间线事件（memory flush 锚点）。
   */
  private async maybeCompactIfNeeded(
    conversationId: string,
    excludeMessageId: string | null,
    model?: string,
  ): Promise<void> {
    if (!this.policy.compaction.enabled) return;
    const tailKeep = this.policy.compaction.tail_messages;
    const allBefore = this.messageRepo
      .find_by_conversation(conversationId, 5000, 0, 'asc')
      .filter((m) => (excludeMessageId ? m.id !== excludeMessageId : true));
    if (allBefore.length <= tailKeep) return;

    const row = this.compactionRepo.get(conversationId);
    let verbatim: Message[];
    let prevSummary: string | null;
    if (row) {
      const anchor = this.messageRepo.find_by_id(row.first_kept_message_id);
      if (!anchor) {
        verbatim = allBefore;
        prevSummary = null;
      } else {
        const idx = allBefore.findIndex((m) => m.id === anchor.id);
        verbatim = idx === -1 ? allBefore : allBefore.slice(idx);
        prevSummary = row.summary_text;
      }
    } else {
      verbatim = allBefore;
      prevSummary = null;
    }

    const threshold = Math.floor(
      this.policy.token_budget.memory *
        this.policy.compaction.token_trigger_ratio,
    );
    const textBlob = [prevSummary, ...verbatim.map((m) => m.content)]
      .filter(Boolean)
      .join('\n');
    const est = estimateTokens(textBlob);
    const needLen = verbatim.length > tailKeep * 2;
    const needTok = est > threshold;
    if (!needLen && !needTok) return;
    if (verbatim.length <= tailKeep) return;

    const head = verbatim.slice(0, verbatim.length - tailKeep);
    const tail = verbatim.slice(-tailKeep);
    if (head.length === 0) return;

    this.timelineRepo.add({
      id: crypto.randomUUID(),
      conversation_id: conversationId,
      event_type: 'compaction_flush',
      role: null,
      message_id: null,
      content: `Compaction: fold ${head.length} messages; keep from ${tail[0].id}`,
    });

    const sessionFragment = this.contextRepo.getSessionNote(conversationId);
    const compactionAppendix =
      sessionFragment?.trim() ?
        `\n\n【本会话备忘（将随本次压缩并入摘要后清空）】\n${sessionFragment.trim()}`
      : '';
    const summary = await this.summarizeForCompaction(
      prevSummary,
      head,
      model,
      compactionAppendix || null,
    );
    this.compactionRepo.upsert({
      conversation_id: conversationId,
      summary_text: summary,
      first_kept_message_id: tail[0].id,
    });
    if (compactionAppendix) this.contextRepo.clearSessionNote(conversationId);
    logger.debug(
      { conversation_id: conversationId, first_kept: tail[0].id },
      '会话 compaction 已更新',
    );
  }

  private async summarizeForCompaction(
    prevSummary: string | null,
    headMessages: Message[],
    model?: string,
    appendix?: string | null,
  ): Promise<string> {
    const lines = headMessages.map((m) => `[${m.role}] ${m.content}`).join('\n');
    const tailAppend = appendix?.trim() ? appendix : '';
    const user = prevSummary
      ? `此前摘要（已压缩）：\n${prevSummary}\n\n请将以下新消息并入同一摘要：\n${lines}${tailAppend}\n\n输出：合并后的中文摘要，约 300–800 字，只输出摘要正文。`
      : `请将以下对话压缩为摘要，保留主题、关键事实、用户立场与未决问题，约 300–800 字，只输出摘要正文：\n${lines}${tailAppend}`;
    const res = await this.llmClient.chat(
      [
        {
          role: 'system',
          content:
            '你是对话摘要压缩器，只输出摘要正文，不要寒暄、不要列表套话。',
        },
        { role: 'user', content: user },
      ],
      model,
    );
    return res.content.trim();
  }

  private async retrieveRelevantMemories(
    queryText: string,
    currentConversationId: string,
  ): Promise<RetrievalResult> {
    if (!this.policy.retrieval.enabled) {
      return {
        lines: [],
        debug: {
          candidates: 0,
          candidates_after_scope_filter: 0,
          dropped_current: 0,
          dropped_dedup: 0,
          selected: 0,
          selected_turn: 0,
          selected_message: 0,
          hits: [],
        },
      };
    }
    if (!queryText.trim()) {
      return {
        lines: [],
        debug: {
          candidates: 0,
          candidates_after_scope_filter: 0,
          dropped_current: 0,
          dropped_dedup: 0,
          selected: 0,
          selected_turn: 0,
          selected_message: 0,
          hits: [],
        },
      };
    }

    try {
      const { vectors } = await this.embeddingClient.embed([queryText]);
      const queryVector = vectors[0];
      if (!queryVector) {
        return {
          lines: [],
          debug: {
            candidates: 0,
            candidates_after_scope_filter: 0,
            dropped_current: 0,
            dropped_dedup: 0,
            selected: 0,
            selected_turn: 0,
            selected_message: 0,
            hits: [],
          },
        };
      }

      const topKTurn = Math.max(0, this.policy.retrieval.top_k_turn);
      const topKMessage = Math.max(0, this.policy.retrieval.top_k_message);
      const totalTarget = topKTurn + topKMessage;
      if (totalTarget <= 0) {
        return {
          lines: [],
          debug: {
            candidates: 0,
            candidates_after_scope_filter: 0,
            dropped_current: 0,
            dropped_dedup: 0,
            selected: 0,
            selected_turn: 0,
            selected_message: 0,
            hits: [],
          },
        };
      }

      const ignored = this.recordRepo.get_ignored_topics();
      const ignoredKeys = ignored.map((t) => normalizeForDedup(t)).filter(Boolean);

      const candidates = await this.vectorStore.query(
        queryVector,
        Math.max(totalTarget * 4, 20),
        this.policy.retrieval.score_threshold,
      );
      let droppedCurrent = 0;
      const scopedCandidates = candidates.filter((item) => {
        if (!this.policy.retrieval.exclude_current_conversation) return true;
        const isCurrent = item.metadata.conversation_id === currentConversationId;
        if (isCurrent) droppedCurrent += 1;
        return !isCurrent;
      });

      const lambda = this.policy.retrieval.time_decay_per_day;
      const ranked = scopedCandidates
        .map((item) => ({
          item,
          adj: retrievalScoreWithDecay(
            item.score,
            item.metadata.source_created_at,
            lambda,
          ),
        }))
        .sort((a, b) => b.adj - a.adj);

      const picked: string[] = [];
      const seenTexts = new Set<string>();
      const hits: RetrievalHitDebug[] = [];
      let droppedDedup = 0;
      let turnCount = 0;
      let messageCount = 0;
      const historyRows =
        currentConversationId
          ? this.messageRepo.find_by_conversation(
              currentConversationId,
              this.policy.recent_turns * 2,
            )
          : [];
      const historyDedupSet = new Set<string>();
      for (const row of historyRows) {
        const norm = normalizeForDedup(row.content);
        if (norm) historyDedupSet.add(norm);
      }

      for (const { item } of ranked) {
        if (
          item.metadata.source_kind === 'turn' &&
          turnCount >= topKTurn
        ) {
          continue;
        }
        if (
          item.metadata.source_kind === 'message' &&
          messageCount >= topKMessage
        ) {
          continue;
        }
        const rawText = item.metadata.source_text?.trim();
        if (!rawText) continue;
        if (ignoredKeys.length) {
          const normText = normalizeForDedup(rawText);
          if (normText && ignoredKeys.some((k) => k && normText.includes(k))) {
            continue;
          }
        }
        if (seenTexts.has(rawText)) continue;
        const dedupKey = normalizeForDedup(rawText);
        if (dedupKey && historyDedupSet.has(dedupKey)) {
          droppedDedup += 1;
          continue;
        }
        const clipped =
          rawText.length > 280 ? `${rawText.slice(0, 280)}...` : rawText;

        const scopeLabel =
          item.metadata.conversation_id === currentConversationId
            ? '当前会话'
            : '跨会话';
        const scope = item.metadata.conversation_id === currentConversationId
          ? 'current'
          : 'cross';
        const kindLabel =
          item.metadata.source_kind === 'turn' ? '对话片段' : '单条消息';
        const kind = item.metadata.source_kind === 'turn' ? 'turn' : 'message';
        picked.push(
          `[${scopeLabel}/${kindLabel}/score:${item.score.toFixed(3)}] ${clipped}`,
        );
        hits.push({
          scope,
          kind,
          score: Number(item.score.toFixed(4)),
          text_preview: clipped,
        });
        seenTexts.add(rawText);
        if (item.metadata.source_kind === 'turn') turnCount += 1;
        if (item.metadata.source_kind === 'message') messageCount += 1;
        if (picked.length >= totalTarget) break;
      }

      return {
        lines: picked,
        debug: {
          candidates: candidates.length,
          candidates_after_scope_filter: scopedCandidates.length,
          dropped_current: droppedCurrent,
          dropped_dedup: droppedDedup,
          selected: picked.length,
          selected_turn: turnCount,
          selected_message: messageCount,
          hits,
        },
      };
    } catch (err) {
      logger.warn({ err }, '检索记忆失败，回退为仅最近历史');
      return {
        lines: [],
        debug: {
          candidates: 0,
          candidates_after_scope_filter: 0,
          dropped_current: 0,
          dropped_dedup: 0,
          selected: 0,
          selected_turn: 0,
          selected_message: 0,
          hits: [],
        },
      };
    }
  }

  private resolveConversation(conversationId?: string) {
    if (conversationId) {
      const conv = this.conversationRepo.find_by_id(conversationId);
      if (!conv) throw new NotFoundError('Conversation', conversationId);
      return conv;
    }
    const currentId = this.conversationRepo.get_current_id();
    if (!currentId) return null;
    return this.conversationRepo.find_by_id(currentId);
  }

  private async runChatWithTools(
    baseMessages: Array<{
      role: 'system' | 'user' | 'assistant' | 'tool';
      content: string;
      tool_call_id?: string;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: {
          name: string;
          arguments: string;
        };
      }>;
    }>,
    model?: string,
    conversationId?: string | null,
    runtimePrefetchCalls: ToolTraceCall[] = [],
  ): Promise<{
    content: string;
    model: string;
    completion_tokens: number;
    tool_trace: ToolTraceRound[];
  }> {
    const tools = this.chatTools.getDefinitions();
    const messages = [...baseMessages];
    let finalContent = '';
    let modelName = model || 'unknown';
    let completionTokens = 0;
    const toolTrace: ToolTraceRound[] = [];
    const maxToolRounds = config.llm.max_tool_rounds;
    if (runtimePrefetchCalls.length > 0) {
      toolTrace.push({
        round: -1,
        used_tools: true,
        assistant_content: '[runtime_policy_prefetch]',
        tool_calls: runtimePrefetchCalls,
      });
    }

    for (let round = 0; round < maxToolRounds; round++) {
      logger.debug(
        {
          round,
          messages_count: messages.length,
          tools: tools.map((t) => t.function.name),
        },
        '工具轮次开始',
      );
      const res = await this.llmClient.chat(messages, model, tools);
      modelName = res.model;
      completionTokens += res.completion_tokens;

      if (!res.tool_calls.length) {
        toolTrace.push({
          round,
          used_tools: false,
          assistant_content: sanitizeAssistantOutput(res.content || ''),
          tool_calls: [],
        });
        logger.debug(
          {
            round,
            used_tools: false,
            assistant_content:
              (res.content || '').length > 800
                ? `${(res.content || '').slice(0, 800)}...`
                : res.content || '',
          },
          '工具轮次结束（无工具调用）',
        );
        finalContent = sanitizeAssistantOutput(res.content || '');
        break;
      }
      logger.debug(
        {
          round,
          used_tools: true,
          tool_calls: res.tool_calls,
        },
        '检测到工具调用',
      );

      messages.push({
        role: 'assistant',
        content: res.content || '',
        tool_calls: res.tool_calls,
      });
      const roundTrace: ToolTraceRound = {
        round,
        used_tools: true,
        assistant_content: sanitizeAssistantOutput(res.content || ''),
        tool_calls: [],
      };

      for (const call of res.tool_calls) {
        const args = safeJsonParse(call.function.arguments);
        const result = await this.chatTools.run(call.function.name, args, {
          conversation_id: conversationId ?? null,
        });
        if (conversationId) {
          this.persistToolSummary(
            conversationId,
            null,
            round,
            call.function.name,
            result,
          );
        }
        roundTrace.tool_calls.push({
          tool_name: call.function.name,
          tool_args: args,
          tool_result: result,
        });
        logger.debug(
          {
            round,
            tool_name: call.function.name,
            tool_args: args,
            tool_result: result,
          },
          '工具执行结果',
        );
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      }
      toolTrace.push(roundTrace);
    }

    if (!finalContent.trim()) {
      logger.warn(
        { max_tool_rounds: maxToolRounds, tool_trace_rounds: toolTrace.length },
        '工具轮结束仍无正文，补发无工具总结',
      );
      const r = await this.tryNoToolsSummaryReply(messages, model);
      completionTokens += r.completion_tokens;
      modelName = r.model || modelName;
      finalContent = this.composeToolExhaustionReply(r.text);
      toolTrace.push({
        round: maxToolRounds,
        used_tools: false,
        assistant_content: finalContent,
        tool_calls: [],
        forced_text_only: true,
      });
    }

    return {
      content: finalContent,
      model: modelName,
      completion_tokens: completionTokens,
      tool_trace: toolTrace,
    };
  }

  private buildRecordContextLines(): string[] {
    const lines: string[] = [];
    const ignored = new Set(
      this.recordRepo.get_ignored_topics().map((t) => normalizeForDedup(t)),
    );
    const identity = this.recordRepo.get_identity();
    if (identity && (identity.name.trim() || identity.notes.trim())) {
      const stale = identity.updated_at ? ` (档案更新于 ${identity.updated_at})` : '';
      lines.push(
        `[用户档案] name=${identity.name || '未知'}; notes=${identity.notes || '无'}${stale}`,
      );
    }
    const prefs = this.recordRepo.list_preferences_for_prompt(5);
    for (const p of prefs) {
      const tag =
        p.memory_kind === 'project_context' ?
          '[进行中约定]'
        : p.memory_kind === 'preference' ?
          '[用户偏好]'
        : `[${p.memory_kind}]`;
      if (ignored.size) {
        const key = normalizeForDedup(`${p.topic} ${p.summary}`);
        if (key && [...ignored].some((t) => t && key.includes(t))) continue;
      }
      lines.push(`${tag} ${p.topic}: ${p.summary}`);
    }
    const corrections = this.recordRepo.list_corrections(3);
    for (const c of corrections) {
      lines.push(`[用户纠错] ${c.previous} -> ${c.correction}`);
    }
    return lines;
  }

  private resolveRuntimePolicy(userText: string): RuntimePolicyExecution {
    const recentCorrections = this.recordRepo.list_corrections(50);
    return executeRuntimePolicy(
      userText,
      recentCorrections.map((c) => ({
        previous: c.previous,
        correction: c.correction,
        why_context: c.why_context,
      })),
    );
  }

  private async runRuntimePolicyPrefetch(
    decision: RuntimePolicyExecution,
    conversation_id: string,
    message_id: string | null,
    round: number,
  ): Promise<{ facts: string[]; calls: ToolTraceCall[] }> {
    const facts: string[] = [];
    const calls: ToolTraceCall[] = [];
    for (const req of decision.required_tools) {
      const result = await this.chatTools.run(req.name, req.args, {
        conversation_id,
      });
      this.persistToolSummary(
        conversation_id,
        message_id,
        round,
        req.name,
        result,
      );
      calls.push({
        tool_name: req.name,
        tool_args: req.args,
        tool_result: result,
      });
      const fact = summarizeRuntimePrefetchFact(req.name, result);
      if (fact) facts.push(fact);
    }
    return { facts, calls };
  }

  private persistToolSummary(
    conversation_id: string,
    message_id: string | null,
    round: number,
    tool_name: string,
    tool_result: Record<string, unknown>,
  ): void {
    const summary = summarizeToolResult(tool_name, tool_result);
    if (!summary.trim()) return;
    this.toolSummaryRepo.add({
      conversation_id,
      message_id,
      round,
      tool_name,
      summary_text: summary,
    });
  }

}

function summarizeToolResult(toolName: string, result: Record<string, unknown>): string {
  if (!result || typeof result !== 'object') return '';
  if (result.ok === false) {
    const err = typeof result.error === 'string' ? result.error : 'tool error';
    return `失败：${err}`;
  }
  if (toolName === 'record') {
    if (typeof result.message === 'string') return result.message;
    return '已写入记录';
  }
  if (toolName === 'get_record') {
    const keys = Object.keys(result).filter((k) => k !== 'ok');
    return keys.length ? `读取：${keys.join(', ')}` : '已读取记录';
  }
  if (toolName === 'get_current_time') {
    if (typeof result.datetime === 'string') return `当前时间：${result.datetime}`;
    return '已获取当前时间';
  }
  if (toolName === 'search_memories') {
    const n = Array.isArray(result.memories) ? result.memories.length : 0;
    return `检索到 ${n} 条相关记忆`;
  }
  if (toolName === 'get_timeline') {
    const n = Array.isArray(result.evidence) ? result.evidence.length : 0;
    return `时间线证据 ${n} 条`;
  }
  if (toolName === 'web_search') {
    const n = Array.isArray(result.results) ? result.results.length : 0;
    return `网络检索结果 ${n} 条`;
  }
  if (toolName === 'web_fetch') {
    const chars = typeof result.content === 'string' ? result.content.length : 0;
    return `网页抓取正文 ${chars} 字`;
  }
  return '工具已执行';
}

function normalizeForDedup(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[“”"']/g, '')
    .replace(/[，。！？、,.!?;；:：\-—]/g, '')
    .trim()
    .toLowerCase();
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function summarizeRuntimePrefetchFact(
  toolName: string,
  result: Record<string, unknown>,
): string {
  if (result.ok === false) {
    const err = typeof result.error === 'string' ? result.error : 'tool error';
    return `[${toolName}] 失败：${err}`;
  }
  if (toolName === 'get_current_time') {
    const dt = typeof result.datetime === 'string' ? result.datetime : '';
    return dt ? `[get_current_time] 当前时间：${dt}` : '[get_current_time] 已获取当前时间';
  }
  if (toolName === 'get_timeline') {
    const evidence = Array.isArray(result.evidence) ? result.evidence.length : 0;
    const global = Array.isArray(result.global_records) ? result.global_records.length : 0;
    return `[get_timeline] evidence=${evidence}, global_records=${global}`;
  }
  if (toolName === 'web_search') {
    const n = Array.isArray(result.results) ? result.results.length : 0;
    return `[web_search] results=${n}`;
  }
  return `[${toolName}] 已执行`;
}

function mergeStreamToolCalls(
  state: Map<
    number,
    { id: string; type: 'function'; function: { name: string; arguments: string } }
  >,
  chunks: Array<Record<string, unknown>>,
): void {
  for (let i = 0; i < chunks.length; i++) {
    const call = chunks[i] as Record<string, unknown>;
    const idx =
      typeof call.index === 'number' ? (call.index as number) : i;
    const existing = state.get(idx) ?? {
      id: '',
      type: 'function' as const,
      function: { name: '', arguments: '' },
    };
    const incomingId = typeof call.id === 'string' ? call.id : '';
    if (incomingId) existing.id = incomingId;
    const fn = (call.function as Record<string, unknown> | undefined) ?? {};
    const incomingName = typeof fn.name === 'string' ? fn.name : '';
    if (incomingName) existing.function.name = incomingName;
    const incomingArgs = typeof fn.arguments === 'string' ? fn.arguments : '';
    if (incomingArgs) existing.function.arguments += incomingArgs;
    if (!existing.id) existing.id = crypto.randomUUID();
    state.set(idx, existing);
  }
}
