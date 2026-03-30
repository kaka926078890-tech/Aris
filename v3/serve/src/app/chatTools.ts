import type {
  IConversationRepo,
  IEmbeddingClient,
  IMessageRepo,
  IRecordRepo,
  IVectorStore,
} from '../types.js';
import { TimelineRepo } from '../infra/timelineRepo.js';

type ToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export class ChatTools {
  constructor(
    private recordRepo: IRecordRepo,
    private embeddingClient: IEmbeddingClient,
    private vectorStore: IVectorStore,
    private conversationRepo: IConversationRepo,
    private messageRepo: IMessageRepo,
    private timelineRepo: TimelineRepo,
  ) {}

  getDefinitions(): ToolDef[] {
    return [
      {
        type: 'function',
        function: {
          name: 'record',
          description:
            '写入聊天相关记录。type=identity 用于记录用户名字/身份备注；type=preference 用于记录稳定喜好；type=correction 用于记录用户纠错。只有在用户明确表达时才写入，不要臆造。',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['identity', 'preference', 'correction'],
              },
              payload: {
                type: 'object',
                description:
                  'identity: {name?, notes?}; preference: {topic, summary, source?, tags?}; correction: {previous, correction}',
              },
            },
            required: ['type', 'payload'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_record',
          description:
            '读取聊天相关记录。type=identity 读取用户档案；type=preferences 读取喜好（可按 topic/limit）；type=corrections 读取纠错（可按 limit）。',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['identity', 'preferences', 'corrections'],
              },
              options: {
                type: 'object',
                description:
                  'preferences 支持 {topic?, limit?}；corrections 支持 {limit?}；identity 无需 options',
              },
            },
            required: ['type'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'search_memories',
          description:
            '按语义检索历史记忆（跨会话），返回相关对话片段/消息。适用于“我之前说过什么”“以前提到过XX吗”这类问题。',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: '检索关键词或问题，尽量包含核心概念',
              },
              limit: {
                type: 'number',
                default: 6,
                description: '返回条数，建议 1-10',
              },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_current_time',
          description: '获取当前日期与时间（用户本地时区）。',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'get_timeline',
          description:
            '获取可验证的时间线证据（按时间排序），用于回忆/复盘/总结/判断先后顺序。返回的 evidence 仅来自数据库事件与消息，不会编造。',
          parameters: {
            type: 'object',
            properties: {
              conversation_id: {
                type: 'string',
                description:
                  '可选：指定会话 id；不传则默认当前会话（current conversation）',
              },
              limit: {
                type: 'number',
                default: 30,
                description: '返回条数，建议 10-80',
              },
              include_global_records: {
                type: 'boolean',
                default: true,
                description:
                  '是否附带全局记录类事件（identity/preference/correction）作为背景（不参与会话顺序）',
              },
            },
          },
        },
      },
    ];
  }

  async run(name: string, args: Record<string, unknown>) {
    if (name === 'record') return this.runRecord(args);
    if (name === 'get_record') return this.runGetRecord(args);
    if (name === 'search_memories') return this.runSearchMemories(args);
    if (name === 'get_current_time') {
      const now = new Date();
      return {
        ok: true,
        datetime: now.toLocaleString('zh-CN', {
          dateStyle: 'long',
          timeStyle: 'short',
          hour12: false,
        }),
        iso: now.toISOString(),
      };
    }
    if (name === 'get_timeline') return this.runGetTimeline(args);
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  private runRecord(args: Record<string, unknown>) {
    const type = String(args.type ?? '').toLowerCase();
    const payload = (args.payload ?? {}) as Record<string, unknown>;
    if (type === 'identity') {
      this.recordRepo.set_identity({
        name: payload.name ? String(payload.name) : undefined,
        notes: payload.notes ? String(payload.notes) : undefined,
      });
      return { ok: true, message: 'identity 已记录' };
    }
    if (type === 'preference') {
      const topic = String(payload.topic ?? '').trim();
      const summary = String(payload.summary ?? '').trim();
      if (!topic || !summary) {
        return { ok: false, error: 'preference 需要 topic 与 summary' };
      }
      const id = this.recordRepo.add_preference({
        topic,
        summary,
        source: payload.source ? String(payload.source) : undefined,
        tags: Array.isArray(payload.tags)
          ? payload.tags.map((x) => String(x)).filter(Boolean)
          : undefined,
      });
      return { ok: true, id, message: 'preference 已记录' };
    }
    if (type === 'correction') {
      const previous = String(payload.previous ?? '').trim();
      const correction = String(payload.correction ?? '').trim();
      if (!previous || !correction) {
        return { ok: false, error: 'correction 需要 previous 与 correction' };
      }
      const id = this.recordRepo.add_correction({ previous, correction });
      return { ok: true, id, message: 'correction 已记录' };
    }
    return { ok: false, error: `不支持的 record type: ${type}` };
  }

  private runGetRecord(args: Record<string, unknown>) {
    const type = String(args.type ?? '').toLowerCase();
    const options = (args.options ?? {}) as Record<string, unknown>;
    if (type === 'identity') {
      return { ok: true, identity: this.recordRepo.get_identity() };
    }
    if (type === 'preferences') {
      const list = this.recordRepo.list_preferences(
        options.topic ? String(options.topic) : undefined,
        options.limit ? Number(options.limit) : 20,
      );
      return { ok: true, preferences: list };
    }
    if (type === 'corrections') {
      const list = this.recordRepo.list_corrections(
        options.limit ? Number(options.limit) : 20,
      );
      return { ok: true, corrections: list };
    }
    return { ok: false, error: `不支持的 get_record type: ${type}` };
  }

  private async runSearchMemories(args: Record<string, unknown>) {
    const query = String(args.query ?? '').trim();
    const limit = Math.max(1, Math.min(20, Number(args.limit ?? 6)));
    if (!query) return { ok: false, error: 'query 不能为空' };
    const { vectors } = await this.embeddingClient.embed([query]);
    const qv = vectors[0];
    if (!qv) return { ok: true, memories: [], text: '（无可用向量）' };
    const rows = await this.vectorStore.query(qv, limit * 3, 0.45);
    const picked = rows.slice(0, limit).map((r) => ({
      score: r.score,
      kind: r.metadata.source_kind,
      conversation_id: r.metadata.conversation_id,
      text: r.metadata.source_text,
    }));
    return {
      ok: true,
      memories: picked,
      text: picked.map((x) => x.text).filter(Boolean).join('\n---\n'),
    };
  }

  private runGetTimeline(args: Record<string, unknown>) {
    const requested = String(args.conversation_id ?? '').trim();
    const conversation_id =
      requested || this.conversationRepo.get_current_id() || '';
    if (!conversation_id) {
      return { ok: true, conversation_id: null, evidence: [] };
    }
    const limit = Math.max(1, Math.min(200, Number(args.limit ?? 30)));
    const include_global = args.include_global_records !== false;

    // 1) 会话内的可验证证据：events（优先） + fallback messages（兼容旧数据）
    const events = this.timelineRepo.list_recent(conversation_id, limit);
    const evidence =
      events.length > 0
        ? events
            .slice()
            .reverse()
            .map((e) => ({
              t: e.created_at,
              type: e.event_type,
              role: e.role,
              content: e.content,
              message_id: e.message_id,
            }))
        : this.messageRepo
            .find_by_conversation(conversation_id, limit, 0, 'asc')
            .map((m) => ({
              t: m.created_at,
              type: 'chat_message',
              role: m.role,
              content: m.content,
              message_id: m.id,
            }));

    // 2) 全局记录类证据（不参与会话顺序，只做背景）
    const global_records = include_global
      ? this.timelineRepo
          .list_recent(null, 50)
          .slice()
          .reverse()
          .map((e) => ({
            t: e.created_at,
            type: e.event_type,
            role: e.role,
            content: e.content,
            message_id: e.message_id,
          }))
      : [];

    return {
      ok: true,
      conversation_id,
      evidence,
      global_records,
      note:
        'evidence 仅是可验证证据；当你要复盘/总结/判断先后顺序时，应只基于 evidence 叙述，超出部分必须标注“不在证据中”。',
    };
  }
}
