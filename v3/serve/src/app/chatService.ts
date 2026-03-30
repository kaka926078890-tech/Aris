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
  PromptPolicyConfig,
  ToolTraceRound,
} from '../types.js';
import { PromptBuilder } from './promptBuilder.js';
import { loadPromptPolicy } from './promptPolicy.js';
import { ChatTools } from './chatTools.js';
import { NotFoundError } from '../errors.js';
import { logger } from '../logger.js';

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

export class ChatService {
  private policy: PromptPolicyConfig;
  private promptBuilder: PromptBuilder;
  private chatTools: ChatTools;

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
    this.chatTools = new ChatTools(recordRepo, embeddingClient, vectorStore);
  }

  async preview(req: ChatPreviewRequest): Promise<ChatPreviewResponse> {
    const conversation = this.resolveConversation(req.conversation_id);
    const conversationId = conversation?.id ?? null;

    const history = conversationId
      ? this.messageRepo.find_by_conversation(
          conversationId,
          this.policy.recent_turns * 2,
        )
      : [];
    const retrieval = await this.retrieveRelevantMemories(
      req.message,
      conversationId ?? '',
    );
    const recordContext = this.buildRecordContextLines();
    const trace = this.promptBuilder.build(
      this.policy,
      history,
      req.message,
      {
        record_lines: recordContext,
        retrieval_lines: retrieval.lines,
      },
    );

    return { conversation_id: conversationId, trace };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
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

    // 3) 取最近历史，组装最小提示词
    const recentMessages = this.messageRepo.find_by_conversation(
      conversation.id,
      this.policy.recent_turns * 2,
    );
    const history = recentMessages.filter((m) => m.id !== userMsg.id);
    const retrieval = await this.retrieveRelevantMemories(
      req.message,
      conversation.id,
    );
    const recordContext = this.buildRecordContextLines();
    const promptPackage = this.promptBuilder.build(
      this.policy,
      history,
      req.message,
      {
        record_lines: recordContext,
        retrieval_lines: retrieval.lines,
      },
    );

    const promptChars = promptPackage.messages.map((m) => m.content.length);
    const roleCounts = {
      system: promptPackage.messages.filter((m) => m.role === 'system').length,
      user: promptPackage.messages.filter((m) => m.role === 'user').length,
      assistant: promptPackage.messages.filter((m) => m.role === 'assistant').length,
    };
    logger.info(
      {
        conversation_id: conversation.id,
        token_usage: promptPackage.token_usage,
        prompt_messages: promptPackage.messages.length,
        prompt_role_counts: roleCounts,
        prompt_chars_total: promptChars.reduce((a, b) => a + b, 0),
        prompt_chars_max: promptChars.length ? Math.max(...promptChars) : 0,
        retrieval: retrieval.debug,
        record_context_lines: recordContext.length,
      },
      '提示词已组装',
    );

    // 4) 调用对话模型（含工具层）
    const llmRes = await this.runChatWithTools(promptPackage.messages, req.model);

    // 5) 保存助手回复
    const assistantMsg = this.messageRepo.create(
      conversation.id,
      'assistant',
      llmRes.content,
      llmRes.completion_tokens,
      { tool_trace: llmRes.tool_trace },
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
        });
      }
      if (vectors[1]) {
        await this.vectorStore.upsert(assistantMsg.id, vectors[1], {
          message_id: assistantMsg.id,
          conversation_id: conversation.id,
          source_kind: 'message',
          source_text: assistantMsg.content,
        });
      }
      if (vectors[2]) {
        const turnText = this.buildTurnText(userMsg.content, assistantMsg.content);
        await this.vectorStore.upsert(`turn:${assistantMsg.id}`, vectors[2], {
          message_id: assistantMsg.id,
          conversation_id: conversation.id,
          source_kind: 'turn',
          source_text: turnText,
        });
      }
    } catch (err) {
      logger.warn({ err }, '向量化失败，不影响主对话');
    }

    return {
      conversation_id: conversation.id,
      message: assistantMsg,
      model: llmRes.model,
      tool_trace: llmRes.tool_trace,
      trace: req.include_trace ? promptPackage : undefined,
    };
  }

  private buildTurnText(userText: string, assistantText: string): string {
    return `用户：${userText}\nAris：${assistantText}`;
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

      for (const item of scopedCandidates) {
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
  ): Promise<{
    content: string;
    model: string;
    completion_tokens: number;
    tool_trace: ToolTraceRound[];
  }> {
    const tools = this.chatTools.getDefinitions();
    const messages = [...baseMessages];
    const toolPolicyMessage = this.buildToolPolicyMessage();
    const firstNonSystemIdx = messages.findIndex((m) => m.role !== 'system');
    if (firstNonSystemIdx === -1) {
      messages.push({ role: 'system', content: toolPolicyMessage });
    } else {
      messages.splice(firstNonSystemIdx, 0, {
        role: 'system',
        content: toolPolicyMessage,
      });
    }
    let finalContent = '';
    let modelName = model || 'unknown';
    let completionTokens = 0;
    const toolTrace: ToolTraceRound[] = [];

    for (let round = 0; round < 3; round++) {
      logger.info(
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
          assistant_content: res.content || '',
          tool_calls: [],
        });
        logger.info(
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
        finalContent = res.content;
        break;
      }
      logger.info(
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
        assistant_content: res.content || '',
        tool_calls: [],
      };

      for (const call of res.tool_calls) {
        const args = safeJsonParse(call.function.arguments);
        const result = await this.chatTools.run(call.function.name, args);
        roundTrace.tool_calls.push({
          tool_name: call.function.name,
          tool_args: args,
          tool_result: result,
        });
        logger.info(
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

    return {
      content: finalContent,
      model: modelName,
      completion_tokens: completionTokens,
      tool_trace: toolTrace,
    };
  }

  private buildToolPolicyMessage(): string {
    return [
      '工具调用策略（必须遵守）：',
      '1) 用户明确提供身份信息（名字、称呼、身份备注）时，先调用 record(type=identity)。',
      '2) 用户表达稳定偏好/厌恶（喜欢/不喜欢/偏好）时，调用 record(type=preference)。',
      '3) 用户纠正你说错的话时，调用 record(type=correction)。',
      '4) 需要核对历史信息时优先调用 get_record 或 search_memories。',
      '5) 调工具后再继续回答用户；不要只口头说“记住了”却不调用工具。',
      '6) 若涉及“现在/今天/早晚/饭点/节律”等时间语境，先调用 get_current_time 再回答。',
    ].join('\n');
  }

  private buildRecordContextLines(): string[] {
    const lines: string[] = [];
    const identity = this.recordRepo.get_identity();
    if (identity && (identity.name.trim() || identity.notes.trim())) {
      lines.push(
        `[用户档案] name=${identity.name || '未知'}; notes=${identity.notes || '无'}`,
      );
    }
    const prefs = this.recordRepo.list_preferences(undefined, 5);
    for (const p of prefs) {
      lines.push(`[用户偏好] ${p.topic}: ${p.summary}`);
    }
    const corrections = this.recordRepo.list_corrections(3);
    for (const c of corrections) {
      lines.push(`[用户纠错] ${c.previous} -> ${c.correction}`);
    }
    return lines;
  }

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
