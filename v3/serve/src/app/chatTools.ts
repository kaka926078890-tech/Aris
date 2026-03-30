import type { IEmbeddingClient, IRecordRepo, IVectorStore } from '../types.js';

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
}
