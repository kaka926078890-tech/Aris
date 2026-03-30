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
    const system_content = policy.system_template
      .replace('{persona}', policy.persona)
      .trim() + `\n\n当前本地时间（用于语境判断）：${nowLocal}`;

    const system_tokens = estimateTokens(system_content);

    const memory_budget = policy.token_budget.memory;
    const memory_messages: PromptMessage[] = [];
    let memory_tokens = 0;

    const record_lines = context.record_lines ?? [];
    if (record_lines.length > 0) {
      const record_block = [
        '以下是已确认的长期用户记忆（身份/偏好/纠错），优先作为事实依据：',
        ...record_lines.map((item, idx) => `${idx + 1}. ${item}`),
      ].join('\n');
      const t = estimateTokens(record_block);
      if (memory_tokens + t <= memory_budget) {
        memory_messages.push({ role: 'system', content: record_block });
        memory_tokens += t;
      }
    }

    const retrieval_lines = context.retrieval_lines ?? [];
    if (retrieval_lines.length > 0) {
      const memory_block = [
        '以下是与当前问题语义相关的历史记忆片段（可能来自其他会话），仅在相关时参考：',
        ...retrieval_lines.map((item, idx) => `${idx + 1}. ${item}`),
      ].join('\n');
      const t = estimateTokens(memory_block);
      if (memory_tokens + t <= memory_budget) {
        memory_messages.push({ role: 'system', content: memory_block });
        memory_tokens += t;
      }
    }

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
      const content = isOldHistory
        ? `[较早历史 ${historyLocal}] ${clipped}`
        : `[历史时间 ${historyLocal}] ${normalized}`;
      const t = estimateTokens(content);
      if (memory_tokens + t > memory_budget) break;
      memory_messages.unshift({ role: msg.role, content });
      memory_tokens += t;
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
