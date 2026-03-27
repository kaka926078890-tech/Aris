import type { PromptPolicyConfig } from '../types.js';
import { config } from '../config.js';

const DEFAULT_PERSONA = `You are Aris, a thoughtful companion who remembers past conversations and engages with genuine warmth and curiosity.`;

const DEFAULT_SYSTEM_TEMPLATE = `{persona}

{memory_context}`;

export function loadPromptPolicy(): PromptPolicyConfig {
  return {
    tokenBudget: { ...config.prompt.tokenBudget },
    retrieval: { ...config.prompt.retrieval },
    recentTurns: config.prompt.recentTurns,
    systemTemplate: DEFAULT_SYSTEM_TEMPLATE,
    persona: DEFAULT_PERSONA,
  };
}

/**
 * Rough token estimator (no external dependency).
 * ~4 chars/token for Latin scripts, ~1.5 chars/token for CJK.
 */
export function estimateTokens(text: string): number {
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
  const rest = text.length - cjk;
  return Math.ceil(cjk / 1.5 + rest / 4);
}
