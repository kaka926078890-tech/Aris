import type {
  IConversationRepo,
  IEmbeddingClient,
  IMessageRepo,
  IRecordRepo,
  IVectorStore,
  PreferenceMemoryKind,
} from '../types.js';
import { TimelineRepo } from '../infra/timelineRepo.js';
import type { ConversationContextRepo } from '../infra/conversationContextRepo.js';
import { config } from '../config.js';
import { WebResearchEngine } from './webResearch.js';

const PREFERENCE_KINDS: PreferenceMemoryKind[] = [
  'preference',
  'interaction_feedback',
  'project_context',
  'reference_pointer',
];

function scoreWithTimeDecay(
  score: number,
  createdAt: string | undefined,
  lambdaPerDay: number,
): number {
  if (!lambdaPerDay || lambdaPerDay <= 0 || !createdAt) return score;
  const days = (Date.now() - new Date(createdAt).getTime()) / 86_400_000;
  if (days <= 0) return score;
  return score * Math.exp(-days * lambdaPerDay);
}

type ToolDef = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export class ChatTools {
  private webResearchEngine = new WebResearchEngine();

  constructor(
    private recordRepo: IRecordRepo,
    private embeddingClient: IEmbeddingClient,
    private vectorStore: IVectorStore,
    private conversationRepo: IConversationRepo,
    private messageRepo: IMessageRepo,
    private timelineRepo: TimelineRepo,
    private conversationContextRepo: ConversationContextRepo,
  ) {}

  getDefinitions(): ToolDef[] {
    const defs: ToolDef[] = [
      {
        type: 'function',
        function: {
          name: 'record',
          description:
            '写入记录。勿存整段聊天流水或临时进度（临时进度用 session_context）。仅用户明确表达时写入，禁止臆造。禁止编造 URL。',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: [
                  'identity',
                  'preference',
                  'correction',
                  'session_context',
                  'ignore_topics',
                ],
              },
              payload: {
                type: 'object',
                description:
                  'identity:{name?,notes?}; preference:{topic,summary,source?,tags?,memory_kind?,description?,why_context?,how_to_apply?,expires_at?} memory_kind 可选: preference|interaction_feedback|project_context|reference_pointer；project_context 建议 expires_at(ISO)；correction:{previous,correction,why_context?}; session_context:{note} 仅本会话备忘；ignore_topics:{topics:string[]}',
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
                enum: ['identity', 'preferences', 'corrections', 'ignored_topics'],
              },
              options: {
                type: 'object',
                description:
                  'preferences:{topic?,limit?,memory_kinds?} memory_kinds 为字符串数组时可筛选种类；corrections:{limit?}；identity 无需 options',
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
    if (config.web.enabled) {
      defs.push(
        {
          type: 'function',
          function: {
            name: 'web_search',
            description:
              '搜索公开网页，返回标题、URL、摘要。适用于需要核对外部事实、新闻或文档时。检索词由你在调用时写入参数 `query`，服务端不会替你生成。',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description:
                    '检索用语：请根据当前对话在讨论什么、需要核实什么，自行归纳成适合搜索引擎的简短表达式（关键词或极短问句均可）。',
                },
                max_results: {
                  type: 'number',
                  default: 5,
                  description: '返回结果条数，建议 1-10',
                },
              },
              required: ['query'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'web_fetch',
            description:
              '抓取网页正文。适用于用户已给定 URL 或搜索后需要读取页面详情。',
            parameters: {
              type: 'object',
              properties: {
                url: { type: 'string', description: '必须是 http/https URL' },
                max_chars: {
                  type: 'number',
                  default: 6000,
                  description: '返回正文最大字符数，建议 1000-12000',
                },
              },
              required: ['url'],
            },
          },
        },
      );
    }
    return defs;
  }

  async run(
    name: string,
    args: Record<string, unknown>,
    ctx?: { conversation_id: string | null },
  ) {
    if (name === 'record') return this.runRecord(args, ctx);
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
    if (name === 'web_search') return this.runWebSearch(args);
    if (name === 'web_fetch') return this.runWebFetch(args);
    return { ok: false, error: `Unknown tool: ${name}` };
  }

  private parsePreferenceKind(raw: unknown): PreferenceMemoryKind {
    const k = String(raw ?? 'preference').toLowerCase();
    if (PREFERENCE_KINDS.includes(k as PreferenceMemoryKind)) {
      return k as PreferenceMemoryKind;
    }
    return 'preference';
  }

  private runRecord(
    args: Record<string, unknown>,
    ctx?: { conversation_id: string | null },
  ) {
    const type = String(args.type ?? '').toLowerCase();
    const payload = (args.payload ?? {}) as Record<string, unknown>;
    if (type === 'identity') {
      this.recordRepo.set_identity({
        name: payload.name ? String(payload.name) : undefined,
        notes: payload.notes ? String(payload.notes) : undefined,
      });
      return { ok: true, message: 'identity 已记录' };
    }
    if (type === 'session_context') {
      const note = String(payload.note ?? '').trim();
      if (!note) return { ok: false, error: 'session_context 需要 payload.note' };
      const cid = ctx?.conversation_id?.trim();
      if (!cid) {
        return { ok: false, error: 'session_context 需要当前会话（conversation_id）' };
      }
      this.conversationContextRepo.upsertSessionNote(cid, note);
      return { ok: true, message: '本会话备忘已更新' };
    }
    if (type === 'ignore_topics') {
      const topicsRaw = payload.topics;
      if (!Array.isArray(topicsRaw)) {
        return { ok: false, error: 'ignore_topics 需要 payload.topics: string[]' };
      }
      const next = topicsRaw.map((x) => String(x)).map((s) => s.trim()).filter(Boolean);
      this.recordRepo.set_ignored_topics(next);
      return { ok: true, message: '已更新忽略主题列表', topics: next };
    }
    if (type === 'preference') {
      const topic = String(payload.topic ?? '').trim();
      const summary = String(payload.summary ?? '').trim();
      if (!topic || !summary) {
        return { ok: false, error: 'preference 需要 topic 与 summary' };
      }
      const memory_kind = this.parsePreferenceKind(payload.memory_kind);
      const id = this.recordRepo.add_preference({
        topic,
        summary,
        source: payload.source ? String(payload.source) : undefined,
        tags: Array.isArray(payload.tags)
          ? payload.tags.map((x) => String(x)).filter(Boolean)
          : undefined,
        memory_kind,
        description: payload.description ? String(payload.description) : undefined,
        why_context: payload.why_context ? String(payload.why_context) : undefined,
        how_to_apply: payload.how_to_apply ? String(payload.how_to_apply) : undefined,
        expires_at: payload.expires_at ? String(payload.expires_at) : undefined,
      });
      return { ok: true, id, message: 'preference 已记录', memory_kind };
    }
    if (type === 'correction') {
      const previous = String(payload.previous ?? '').trim();
      const correction = String(payload.correction ?? '').trim();
      if (!previous || !correction) {
        return { ok: false, error: 'correction 需要 previous 与 correction' };
      }
      const id = this.recordRepo.add_correction({
        previous,
        correction,
        why_context: payload.why_context ? String(payload.why_context) : undefined,
      });
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
    if (type === 'ignored_topics') {
      return { ok: true, ignored_topics: this.recordRepo.get_ignored_topics() };
    }
    if (type === 'preferences') {
      const limit = options.limit ? Number(options.limit) : 20;
      const kindsRaw = options.memory_kinds;
      const list = Array.isArray(kindsRaw)
        ? this.recordRepo.list_preferences_by_memory_kinds(
            kindsRaw.map((x) => String(x)),
            limit,
          )
        : this.recordRepo.list_preferences(
            options.topic ? String(options.topic) : undefined,
            limit,
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
    const lambda = config.prompt.retrieval.time_decay_per_day;
    const ranked = rows
      .map((r) => ({
        r,
        adj: scoreWithTimeDecay(r.score, r.metadata.source_created_at, lambda),
      }))
      .sort((a, b) => b.adj - a.adj);
    const picked = ranked.slice(0, limit).map(({ r, adj }) => ({
      score: r.score,
      adjusted_score: Number(adj.toFixed(6)),
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

  private async runWebSearch(args: Record<string, unknown>) {
    const query = String(args.query ?? '').trim();
    if (!query) {
      return {
        ok: false,
        error: 'query 不能为空',
        hint: '请在参数 query 中传入你根据当前对话主题与待核实问题自行归纳的检索用语；服务端不会代为填写。',
      };
    }
    return this.webResearchEngine.search(query, args.max_results);
  }

  private async runWebFetch(args: Record<string, unknown>) {
    return this.webResearchEngine.fetch(args.url, args.max_chars);
  }
}
