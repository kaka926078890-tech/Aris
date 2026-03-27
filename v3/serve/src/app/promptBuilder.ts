import type {
  PromptMessage,
  PromptPackage,
  RetrievalHit,
  Message,
  PromptPolicyConfig,
} from '../types.js';
import { estimateTokens } from './promptPolicy.js';

export class PromptBuilder {
  build(
    policy: PromptPolicyConfig,
    recentMessages: Message[],
    retrievalHits: RetrievalHit[],
    userInput: string,
  ): PromptPackage {
    // 1 — System block
    let memoryContext = '';
    if (retrievalHits.length > 0) {
      const snippets = retrievalHits.map(
        (h, i) =>
          `[${i + 1}] (score ${h.score.toFixed(2)}) ${h.role}: ${h.content}`,
      );
      memoryContext = `Relevant past context:\n${snippets.join('\n')}`;
    }

    const systemContent = policy.systemTemplate
      .replace('{persona}', policy.persona)
      .replace('{memory_context}', memoryContext)
      .trim();

    const systemTokens = estimateTokens(systemContent);

    // 2 — Recent conversation (newest first, trim to budget)
    const memoryBudget = policy.tokenBudget.memory;
    const memoryMessages: PromptMessage[] = [];
    let memoryTokens = 0;

    for (let i = recentMessages.length - 1; i >= 0; i--) {
      const msg = recentMessages[i];
      const t = estimateTokens(msg.content);
      if (memoryTokens + t > memoryBudget) break;
      memoryMessages.unshift({ role: msg.role, content: msg.content });
      memoryTokens += t;
    }

    // 3 — User message
    const userTokens = estimateTokens(userInput);

    // 4 — Assemble
    const messages: PromptMessage[] = [
      { role: 'system', content: systemContent },
      ...memoryMessages,
      { role: 'user', content: userInput },
    ];

    return {
      messages,
      tokenUsage: {
        system: systemTokens,
        memory: memoryTokens,
        user: userTokens,
        total: systemTokens + memoryTokens + userTokens,
      },
      retrievalHits,
    };
  }
}
