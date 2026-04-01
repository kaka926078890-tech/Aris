import type {
  PromptMessage,
  PromptPackage,
  Message,
  PromptPolicyConfig,
} from '../types.js';
import { estimateTokens } from './promptPolicy.js';

interface PromptMemoryContext {
  record_lines?: string[];
  retrieval_lines?: string[];
  /** 早期对话 compaction 摘要（OpenClaw 式） */
  compaction_summary?: string | null;
  /** 会话级备忘（短生命周期，与长期 record 分离） */
  session_note?: string | null;
  /** 工具执行摘要（落库后可回注入，避免 tool_trace 被裁剪后丢事实） */
  tool_summaries?: string[];
}

/** 运行时注入协议：避免模型把注入块与用户本轮输入错误绑定 */
const ENGINE_PREAMBLE = [
  '【引擎说明】除你的人格设定与上一条「当前本地时间」外，下文若出现多段说明性文字，均为服务端运行时注入，用于补全上下文。',
  '这些内容与用户本轮输入不一定一一对应；请优先以用户当前自然语言为准。',
  '若注入中的事实与用户刚说的内容矛盾，以当前话为准，并可通过工具更新或废弃过时记录。',
].join('\n');

function wrapInject(kind: string, body: string): string {
  return `<!-- aris:${kind} -->\n${body}\n<!-- /aris:${kind} -->`;
}

export class PromptBuilder {
  build(
    policy: PromptPolicyConfig,
    recent_messages: Message[],
    user_input: string,
    context: PromptMemoryContext = {},
  ): PromptPackage {
    const nowLocal = new Date().toLocaleString('zh-CN', {
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    const system_content =
      policy.system_template.replace('{persona}', policy.persona).trim() +
      `\n\n${ENGINE_PREAMBLE}\n\n当前本地时间（用于语境判断）：${nowLocal}`;

    const system_tokens = estimateTokens(system_content);

    const memory_budget = policy.token_budget.memory;
    const memory_messages: PromptMessage[] = [];
    let memory_tokens = 0;

    const session_note = context.session_note?.trim();
    if (session_note) {
      const inner = [
        '【本会话备忘】仅本会话相关的临时进度或约定（非长期档案）。若与当前用户句冲突以当前句为准。',
        session_note,
      ].join('\n');
      const block = wrapInject('session_context', inner);
      const t = estimateTokens(block);
      if (memory_tokens + t <= memory_budget) {
        memory_messages.push({ role: 'system', content: block });
        memory_tokens += t;
      }
    }

    const compaction_summary = context.compaction_summary?.trim();
    if (compaction_summary) {
      const inner = [
        '以下是对话早期内容的压缩摘要（仅作背景；用户当前这句话优先；不要默认把「当前问题」当成在讨论摘要里的旧话题）。',
        '摘要可能遗漏细节；若用户追问精确原话、先后顺序或需可验证复述，必须再调用 get_timeline 或 search_memories 取证，不得仅凭摘要断言。',
        compaction_summary,
      ].join('\n');
      const block = wrapInject('compaction', inner);
      const t = estimateTokens(block);
      if (memory_tokens + t <= memory_budget) {
        memory_messages.push({ role: 'system', content: block });
        memory_tokens += t;
      }
    }

    const record_lines = context.record_lines ?? [];
    if (record_lines.length > 0) {
      const inner = [
        '以下是已确认的长期用户记忆（身份、稳定偏好、纠错等），可作事实参考。',
        '记忆是某时刻快照，可能已过时；若与用户当前陈述冲突，以当前话为准，并应考虑通过 record 更新。',
        ...record_lines.map((item, idx) => `${idx + 1}. ${item}`),
      ].join('\n');
      const block = wrapInject('record_facts', inner);
      const t = estimateTokens(block);
      if (memory_tokens + t <= memory_budget) {
        memory_messages.push({ role: 'system', content: block });
        memory_tokens += t;
      }
    }

    const retrieval_lines = context.retrieval_lines ?? [];
    if (retrieval_lines.length > 0) {
      const inner = [
        '以下是与当前问题语义相关的历史片段（可能来自其他会话），仅在确实相关时参考。',
        '引用时不要假装是「用户刚才说的」；跨会话内容用「你以前提到过」等表述。',
        ...retrieval_lines.map((item, idx) => `${idx + 1}. ${item}`),
      ].join('\n');
      const block = wrapInject('retrieval', inner);
      const t = estimateTokens(block);
      if (memory_tokens + t <= memory_budget) {
        memory_messages.push({ role: 'system', content: block });
        memory_tokens += t;
      }
    }

    const tool_summaries = context.tool_summaries ?? [];
    if (tool_summaries.length > 0) {
      const inner = [
        '以下是近期工具执行的简要摘要（可用于回忆与自洽；若用户追问细节仍应再次调用相应工具取证）：',
        ...tool_summaries.map((item, idx) => `${idx + 1}. ${item}`),
      ].join('\n');
      const block = wrapInject('tool_summaries', inner);
      const t = estimateTokens(block);
      if (memory_tokens + t <= memory_budget) {
        memory_messages.push({ role: 'system', content: block });
        memory_tokens += t;
      }
    }

    const history_time_hints: string[] = [];
    for (let i = recent_messages.length - 1; i >= 0; i--) {
      const msg = recent_messages[i];
      const distanceFromLatest = recent_messages.length - 1 - i;
      const historyLocal = new Date(msg.created_at).toLocaleString('zh-CN', {
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
      const strongHistoryWindow = Math.max(2, Math.floor(policy.recent_turns * 0.6));
      const isOldHistory = distanceFromLatest >= strongHistoryWindow;
      const normalized = msg.content.replace(/\s+/g, ' ').trim();
      const clipped = normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized;
      const content = isOldHistory ? clipped : normalized;
      const t = estimateTokens(content);
      if (memory_tokens + t > memory_budget) break;
      memory_messages.unshift({ role: msg.role, content });
      memory_tokens += t;
      const roleLabel = msg.role === 'user' ? '用户' : 'Aris';
      history_time_hints.unshift(
        `${roleLabel} @ ${historyLocal}${isOldHistory ? '（较早）' : ''}`,
      );
    }

    if (history_time_hints.length > 0) {
      const inner = [
        '最近历史时间锚点（仅用于语境判断，不要在回复中原样输出这些标签）：',
        ...history_time_hints.map((item, idx) => `${idx + 1}. ${item}`),
      ].join('\n');
      const block = wrapInject('history_time_hints', inner);
      const t = estimateTokens(block);
      if (memory_tokens + t <= memory_budget) {
        memory_messages.unshift({ role: 'system', content: block });
        memory_tokens += t;
      }
    }

    const user_tokens = estimateTokens(user_input);

    const messages: PromptMessage[] = [
      { role: 'system', content: system_content },
      ...memory_messages,
      { role: 'user', content: user_input },
    ];

    return {
      messages,
      token_usage: {
        system: system_tokens,
        memory: memory_tokens,
        user: user_tokens,
        total: system_tokens + memory_tokens + user_tokens,
      },
    };
  }
}
